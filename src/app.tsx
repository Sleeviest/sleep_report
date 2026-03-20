import React, { useMemo, useState, ChangeEvent } from "react";
// PDF 텍스트 추출을 위한 핵심 라이브러리 (CDN 사용)
import * as pdfjsLib from 'pdfjs-dist';

// shadcn/ui 기반 컴포넌트 (실제 프로젝트 환경에 맞춰 import 경로 수정 필요)
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, FileText, Wand2, ClipboardList, CheckCircle2, AlertTriangle } from "lucide-react";

// PDF.js 워커 설정 (성능 및 호환성 확보)
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

/**
 * Sleep Report Analyzer V1.0 (동료 교수님 증정용)
 *
 * 특징:
 * 1. 로컬 PDF 텍스트 추출: 보안 우수 (서버 전송 없음)
 * 2. Gemini 1.5 Pro API 연결: 고품질 분석
 * 3. Vercel/Netlify 배포 최적화: 링크 공유 방식
 */

// --- 데이터 타입 정의 ---
type ExtractedData = {
  name: string;
  tstMinutes?: number;
  sleepEfficiency?: number;
  sleepLatencyMin?: number;
  wasoMin?: number;
  awakeningCount?: number;
  n3Percent?: number;
  remPercent?: number;
  snsPreSleep?: number;
  pnsPreSleep?: number;
  pnsDeepSleep?: number;
  rmssdMs?: number;
  agi?: number;
};

// --- 유틸리티 함수 ---
function formatMinutes(min?: number) {
  if (min == null) return "미추출";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`;
}

function n(value?: number, unit = "") {
  if (value == null) return "미추출";
  return `${value.toFixed(2)}${unit}`;
}

// ==========================================
// 1. PDF 텍스트 추출 로직 (핵심 추가 기능)
// ==========================================
async function extractTextFromPdf(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: any) => item.str)
      .join(" ");
    fullText += pageText + "\n";
  }
  return fullText;
}

// ==========================================
// 2. Regex 기반 데이터 파싱 (교수님 코드 기반)
// ==========================================
function parseRawText(raw: string): ExtractedData {
  const text = raw.replace(/\r/g, "");
  const matchNumber = (patterns: RegExp[]) => {
    for (const pattern of patterns) {
      const m = text.match(pattern);
      if (m?.[1] != null) return Number(m[1].replace(/,/g, "").trim());
    }
  };

  // 이름 추출 (조금 더 정교하게 수정)
  const nameMatch = text.match(/([가-힣]{2,4})\s*님?/) || text.match(/(?:Name|이름)[^\n:]*[:\s]*([가-힣a-zA-Z\s]{2,20})/);
  
  // TST 시간/분 통합 처리
  const hm = text.match(/(?:Total Sleep Time|TST|실제 수면 시간)[^\n\d]*(\d+)\s*h(?:ours?)?\s*(\d+)\s*m/i);
  const koreanHm = text.match(/(?:Total Sleep Time|TST|실제 수면 시간)[^\n\d]*(\d+)\s*시간\s*(\d+)\s*분/i);
  let tstMinutes = hm ? Number(hm[1]) * 60 + Number(hm[2]) :
                   koreanHm ? Number(koreanHm[1]) * 60 + Number(koreanHm[2]) :
                   matchNumber([/(?:TST|총 수면 시간)[^\n\d]*(\d+(?:\.\d+)?)\s*min/i]);

  return {
    name: nameMatch?.[1]?.trim() || "미입력",
    tstMinutes,
    sleepEfficiency: matchNumber([/(?:Sleep Efficiency|수면 효율)[^\n\d-]*(-?\d+(?:\.\d+)?)\s*%/i]),
    sleepLatencyMin: matchNumber([/(?:Sleep Latency|수면 잠복기)[^\n\d-]*(-?\d+(?:\.\d+)?)\s*min/i]),
    wasoMin: matchNumber([/(?:WASO|자다 깬 시간)[^\n\d-]*(-?\d+(?:\.\d+)?)\s*min/i]),
    awakeningCount: matchNumber([/(?:Awakenings|각성 횟수)[^\n\d-]*(-?\d+(?:\.\d+)?)/i]),
    n3Percent: matchNumber([/(?:N3|Slow Wave Sleep|서파수면)[^\n\d-]*(-?\d+(?:\.\d+)?)\s*%/i]),
    remPercent: matchNumber([/(?:REM)[^\n\d-]*(-?\d+(?:\.\d+)?)\s*%/i]),
    snsPreSleep: matchNumber([/(?:Pre[- ]sleep\s*SNS|취침 전\s*SNS)[^\n\d-]*(-?\d+(?:\.\d+)?)\s*%/i]),
    pnsPreSleep: matchNumber([/(?:Pre[- ]sleep\s*PNS|취침 전\s*PNS)[^\n\d-]*(-?\d+(?:\.\d+)?)\s*%/i]),
    pnsDeepSleep: matchNumber([/(?:Deep sleep\s*PNS|깊은 수면\s*PNS)[^\n\d-]*(-?\d+(?:\.\d+)?)\s*%/i]),
    rmssdMs: matchNumber([/(?:RMSSD)[^\n\d-]*(-?\d+(?:\.\d+)?)\s*ms/i]),
    agi: matchNumber([/(?:AGI|혈관 건강 지수)[^\n\d-]*(-?\d+(?:\.\d+)?)/i]),
  };
}

// ==========================================
// 3. Gemini API 호출 및 분석 (서버리스 연결)
// ==========================================
async function generateAiReport(data: ExtractedData, commentary: string): Promise<string> {
  // Vercel 환경변수에서 API 키 로드 (보안 필수)
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY; 
  if (!apiKey) return "에러: API 키가 설정되지 않았습니다. 관리자에게 문의하세요.";

  const prompt = `역할: 너는 수면 역학 및 자율신경 전문 분석가다.
임무: 제공된 [structured_data]와 사용자의 [commentary]를 결합하여 전문적인 수면 분석 리포트를 작성하라.
작성 규칙:
1. '김명신 님의 케이스'와 같은 고정된 출력 폼을 유지하라.
2. 데이터 수치를 명시하고 메커니즘을 설명하라.
3. 분석자의 코멘트를 반영하여 제언을 개별화하라.

[structured_data]
${JSON.stringify(data, null, 2)}

[commentary]
${commentary.trim() || "별도 코멘트 없음"}
`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7 } // 적절한 창의성
      })
    });
    const result = await response.json();
    return result.candidates?.[0]?.content?.parts?.[0]?.text || "분석 결과를 생성하지 못했습니다.";
  } catch (error) {
    return `API 호출 에러: ${error}`;
  }
}

// --- 메인 UI 컴포넌트 ---
export default function SleepReportAnalyzerV1() {
  const [extracted, setExtracted] = useState<ExtractedData | null>(null);
  const [commentary, setCommentary] = useState("");
  const [finalReport, setFinalReport] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [fileName, setFileName] = useState("");

  // PDF 파일 업로드 핸들러
  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setFileName(file.name);
    setFinalReport(""); // 이전 결과 초기화
    
    try {
      const rawText = await extractTextFromPdf(file);
      const parsedData = parseRawText(rawText);
      setExtracted(parsedData);
    } catch (error) {
      console.error("PDF 처리 에러:", error);
      alert("PDF 파일을 읽는 중 에러가 발생했습니다.");
    } finally {
      setIsLoading(false);
    }
  };

  // AI 분석 시작 핸들러
  const handleStartAnalysis = async () => {
    if (!extracted) return;
    setIsLoading(true);
    try {
      const report = await generateAiReport(extracted, commentary);
      setFinalReport(report);
    } finally {
      setIsLoading(false);
    }
  };

  // 추출 데이터 UI 맵핑
  const extractedFields = extracted ? [
    ["이름", extracted.name],
    ["총 수면 시간", formatMinutes(extracted.tstMinutes)],
    ["수면 효율", n(extracted.sleepEfficiency, "%")],
    ["WASO", extracted.wasoMin != null ? `${extracted.wasoMin}분` : "미추출"],
    ["각성 횟수", extracted.awakeningCount != null ? `${extracted.awakeningCount}회` : "미추출"],
    ["N3", n(extracted.n3Percent, "%")],
    ["RMSSD", n(extracted.rmssdMs, "ms")],
    ["AGI", extracted.agi != null ? extracted.agi.toFixed(2) : "미추출"],
  ] : [];

  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <header className="border-b pb-6">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Sleep Report Analyzer <Badge className="ml-2">V1.0</Badge></h1>
          <p className="mt-2 text-slate-600">동료 교수님을 위한 통합 수면 분석 도구입니다. PDF 파일을 업로드하고 코멘트를 입력하여 전문 리포트를 생성하세요.</p>
        </header>

        <div className="grid gap-8 xl:grid-cols-3">
          {/* 입력 섹션 */}
          <Card className="xl:col-span-1 rounded-2xl shadow-sm border-slate-200">
            <CardHeader className="border-b bg-white rounded-t-2xl">
              <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                <FileText className="h-5 w-5 text-sky-600" /> 리포트 및 코멘트 입력
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 pt-6 bg-white rounded-b-2xl">
              <div className="space-y-3">
                <label className="text-sm font-medium text-slate-700">1. 수면 리포트 PDF 업로드</label>
                <div className="flex items-center justify-center w-full">
                  <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-slate-300 border-dashed rounded-xl cursor-pointer bg-slate-50 hover:bg-slate-100 transition">
                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                      <FileText className="w-8 h-8 mb-3 text-slate-400" />
                      {fileName ? <p className="text-sm font-medium text-sky-700">{fileName}</p> : <p className="text-sm text-slate-500">파일을 드래그하거나 클릭하여 업로드</p>}
                    </div>
                    <input type="file" className="hidden" accept=".pdf" onChange={handleFileUpload} disabled={isLoading} />
                  </label>
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-sm font-medium text-slate-700">2. 분석 코멘트 (선택사항)</label>
                <Textarea
                  className="min-h-[160px] rounded-xl border-slate-300 focus:border-sky-500 focus:ring-sky-500"
                  value={commentary}
                  onChange={(e) => setCommentary(e.target.value)}
                  placeholder="예: 자다가 자주 깨는 점을 강조해주세요. 혈관 건강은 좋다는 점은 긍정적으로 써주세요."
                  disabled={isLoading}
                />
              </div>

              <Button
                className="w-full h-12 rounded-xl text-md font-semibold bg-sky-600 hover:bg-sky-700 transition"
                onClick={handleStartAnalysis}
                disabled={isLoading || !extracted}
              >
                {isLoading ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> 처리 중...</> : <><Wand2 className="mr-2 h-5 w-5" /> AI 분석 리포트 생성</>}
              </Button>
            </CardContent>
          </Card>

          {/* 결과 섹션 */}
          <div className="xl:col-span-2 space-y-8">
            {/* 추출 변수 확인 */}
            <Card className="rounded-2xl shadow-sm border-slate-200 bg-white">
              <CardHeader className="border-b">
                <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                  <ClipboardList className="h-5 w-5 text-emerald-600" /> PDF 데이터 추출 결과
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                {!extracted && !isLoading && (
                  <div className="text-center py-10 border border-dashed rounded-2xl bg-slate-50 border-slate-300">
                    <FileText className="mx-auto h-12 w-12 text-slate-300"/>
                    <p className="mt-4 text-slate-500">PDF 파일을 업로드하면 데이터가 여기에 표시됩니다.</p>
                  </div>
                )}
                {extracted && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {extractedFields.map(([label, value]) => (
                      <div key={label} className="flex items-center justify-between rounded-xl border bg-white px-4 py-3 border-slate-200 hover:border-sky-200 transition">
                        <span className="text-sm text-slate-600 font-medium">{label}</span>
                        <div className="flex items-center gap-1.5">
                          {value !== "미추출" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-amber-500" />}
                          <span className="text-sm font-semibold text-slate-900">{String(value)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 완성형 보고서 */}
            <Card className="rounded-2xl shadow-sm border-slate-200 bg-white">
              <CardHeader className="border-b">
                <CardTitle className="text-lg font-semibold text-slate-900">최종 분석 리포트 (Gemini AI)</CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                {isLoading && !extracted && (
                  <div className="text-center py-16">
                    <Loader2 className="mx-auto h-10 w-10 animate-spin text-sky-500" />
                    <p className="mt-4 text-slate-600">PDF 데이터를 분석하고 있습니다...</p>
                  </div>
                )}
                <ScrollArea className="h-[400px] rounded-xl border border-slate-300 bg-slate-50 p-5">
                  <pre className="whitespace-pre-wrap text-sm leading-7 text-slate-800 font-sans">{finalReport || "AI 분석 결과가 여기에 표시됩니다."}</pre>
                </ScrollArea>
                <Button className="mt-5 w-full bg-emerald-600 hover:bg-emerald-700 rounded-xl" onClick={() => navigator.clipboard.writeText(finalReport)} disabled={!finalReport}>
                  결과 리포트 전체 복사하기
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}