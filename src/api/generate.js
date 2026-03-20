export default async function handler(req, res) {
  console.log("=== API FUNCTION START ===");
  console.log("ENV CHECK:", process.env.GEMINI_API_KEY ? "FOUND" : "NOT FOUND");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.log("❌ API KEY NOT FOUND");
    return res.status(500).json({
      error: "API key missing",
      debug: "process.env.GEMINI_API_KEY is undefined"
    });
  }

  console.log("✅ API KEY FOUND");

  try {
    const { extracted, commentary } = req.body || {};

    console.log("REQUEST BODY EXISTS:", !!req.body);
    console.log("EXTRACTED EXISTS:", !!extracted);

    if (!extracted) {
      return res.status(400).json({
        error: "Missing extracted data"
      });
    }

    const prompt = `
너는 수면 분석 전문가다.

다음 데이터를 기반으로 아래 형식의 리포트를 작성하라.

[출력 형식]
- {이름} 님의 케이스
- 분석결과:
  1. 수면 건강 측면
  2. 자율신경 및 회복력 측면
- 종합 분석 및 제언 (3개 bullet)

[데이터]
${JSON.stringify(extracted, null, 2)}

[사용자 코멘트]
${commentary || "없음"}
`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            temperature: 0.6,
            topP: 0.9
          }
        })
      }
    );

    const data = await response.json();

    console.log("GEMINI RESPONSE STATUS:", response.status);
    console.log("GEMINI RESPONSE HAS CANDIDATES:", !!data?.candidates);

    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "분석 결과 생성 실패";

    return res.status(200).json({ text });
  } catch (error) {
    console.error("❌ INTERNAL ERROR:", error);

    return res.status(500).json({
      error: "Internal Server Error",
      detail: String(error)
    });
  }
}