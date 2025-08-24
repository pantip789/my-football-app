import fetch from "node-fetch";
import * as cheerio from "cheerio";

export default async function handler(req, res) {
  try {
    const url = "https://goal-th.com/";
    const response = await fetch(url);
    const html = await response.text();
    const $ = cheerio.load(html);

    let matches = [];

    $(".list-content .list-item").each((_, el) => {
      const home = $(el).find(".team-left").text().trim();
      const away = $(el).find(".team-right").text().trim();
      const time = $(el).find(".time").text().trim();
      const league = $(el).find(".league").text().trim();
      const link = $(el).find("a").attr("href");

      if (home && away) {
        matches.push({ home, away, time, league, url: `https://goal-th.com${link}` });
      }
    });

    res.status(200).json(matches);
  } catch (e) {
    res.status(500).json({ error: "ดึงข้อมูลไม่สำเร็จ", detail: e.message });
  }
}
