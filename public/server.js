// server.js
// ขั้นตอนติดตั้ง: npm i express cheerio cors
// รัน: node server.js  แล้วเปิด http://localhost:3000
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const app = express();
app.use(cors());

const SOURCE = "https://goal-th.com/";

// helper: ทำความสะอาดข้อความ
const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

// ดึงรายการแมตช์ทั้งหมดจากหน้าแรก goal-th
app.get("/api/matches", async (_req, res) => {
  try {
    const r = await fetch(SOURCE, { headers: { "user-agent": "Mozilla/5.0" } });
    if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
    const html = await r.text();
    const $ = cheerio.load(html);

    const items = [];

    // ไอเดีย: เก็บ "หัวลีก" แล้วเดินเก็บการ์ดแมตช์ด้านล่างๆ จนกว่าจะพบหัวลีกใหม่
    // โครงสร้าง DOM ของ goal-th อาจเปลี่ยนได้ในอนาคต — โค้ดนี้เขียนแบบยืดหยุ่น (heuristic)
    // 1) หา element ที่น่าจะเป็นหัวข้อ "ลีก"
    //    สังเกตในหน้าแรกจะมีข้อความแนว "Premier League | England" (อิงจากหน้า ณ ปัจจุบัน) :contentReference[oaicite:1]{index=1}
    const leagueNodes = $("*:contains('|')").filter((_, el) => {
      const text = clean($(el).text());
      // กรองข้อความที่ดูเหมือนชื่อลีก เช่น มี " | " ระหว่างชื่อกับประเทศ
      return /\S+\s*\|\s*\S+/.test(text) && $(el).children().length === 0;
    });

    // รวม candidate เป็นลำดับในหน้า แล้วไล่ต่อไปหาแมตช์ภายใต้หัวลีกนั้นๆ
    leagueNodes.each((_, el) => {
      const leagueTitle = clean($(el).text()); // เช่น "Premier League | England"
      // เริ่มจาก element นี้ แล้วเดิน *ข้างล่าง* ใกล้ๆ หา “การ์ดแมตช์”
      // เกณฑ์การ์ด: มีลิงก์ไปหน้าดูบอลสด (มี path /ดูบอลสด/?id=...)
      $(el)
        .nextAll()
        .slice(0, 80) // จำกัดระยะค้นหาใต้หัวลีก เพื่อกันล้นไปลีกถัดไป
        .each((__, el2) => {
          const $ctx = $(el2);

          // หาแอ็งเคอร์ที่ชี้ไปหน้าดูบอลสดของ goal-th
          const a = $ctx.find("a[href*='%E0%B8%94%E0%B8%B9%E0%B8%9A%E0%B8%AD%E0%B8%A5%E0%B8%AA%E0%B8%94'][href*='id=']").first();
          if (!a.length) return;

          const url = new URL(a.attr("href"), SOURCE).toString();

          // พยายามอ่านชื่อทีมซ้าย/ขวา (โครงสร้างจริงอาจต่างกัน จึงใช้ heuristic หลายแบบ)
          let home = "";
          let away = "";

          // 1) มองหา element ที่อยู่ใกล้ลิงก์แล้วมีชื่อทีม 2 ฝั่ง
          const textBlock = clean($ctx.text());
          // ลองตัดชื่อทีมด้วยเครื่องหมาย ? - ? หรือ "vs"
          const vsMatch = textBlock.match(/([^\n\r-–]+)\s(?:\?|-|vs|VS|v\.|V\.)\s([^\n\r]+)/);
          if (vsMatch) {
            home = clean(vsMatch[1]);
            away = clean(vsMatch[2]);
          } else {
            // เผื่อกรณีมีรูปทีมสองฝั่งและชื่อเป็น alt/title
            const imgs = $ctx.find("img[alt]");
            if (imgs.length >= 2) {
              home = clean($(imgs.get(0)).attr("alt"));
              away = clean($(imgs.get(1)).attr("alt"));
            }
          }

          // เวลาแข่ง (ถ้ามี) มักแสดงเป็นรูปแบบวันที่/เวลาถัดจากชื่อลีก
          // เราจะพยายามจับ timestamp ที่ดูเหมือน "2025-08-24 20:00:00" จากข้อความในบริเวณนี้
          let time = null;
          const timeMatch =
            textBlock.match(/\b20\d{2}[-/]\d{2}[-/]\d{2}\s+\d{2}:\d{2}(:\d{2})?\b/) ||
            textBlock.match(/\b\d{1,2}:\d{2}\b/); // อย่างน้อยเวลาชั่วโมง:นาที
          if (timeMatch) time = clean(timeMatch[0]);

          // สถานะ: เดาแบบง่ายจากคีย์เวิร์ด (live/จบ/FT)
          let status = "upcoming";
          if (/live|กำลังแข่ง|ถ่ายทอดสด/i.test(textBlock)) status = "live";
          if (/full time|FT|จบเกม|จบ/i.test(textBlock)) status = "finished";

          items.push({
            league: leagueTitle,
            home,
            away,
            time,
            status,
            url,
          });
        });
    });

    // กันซ้ำ: ตาม URL
    const uniq = [];
    const seen = new Set();
    for (const it of items) {
      if (seen.has(it.url)) continue;
      seen.add(it.url);
      uniq.push(it);
    }

    res.json({
      source: SOURCE,
      count: uniq.length,
      matches: uniq,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// เสิร์ฟหน้า static (index.html) หากต้องการ
app.use(express.static("./public"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("server on http://localhost:" + PORT);
});
