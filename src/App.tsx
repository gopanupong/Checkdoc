import React, { useState, useEffect, useRef } from "react";
import {
  UploadCloud,
  FileText,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Copy,
  Check,
  FileUp,
  History,
  Sparkles,
  ExternalLink,
  Search,
  RefreshCw,
  Info,
  BookOpen,
  ArrowRight,
  Database
} from "lucide-react";
import { Document, Issue, FileUploadStatus } from "./types";

export default function App() {
  // Navigation tabs
  const [activeTab, setActiveTab] = useState<"workspace" | "history">("workspace");

  // State for documents
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Upload state
  const [uploadQueue, setUploadQueue] = useState<FileUploadStatus[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Search/Filter state
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pass" | "fail">("all");

  // Selected Gemini model state
  const [selectedModel, setSelectedModel] = useState<string>("gemini-2.5-flash");

  // UX Feedback states
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [selectedIssueIndex, setSelectedIssueIndex] = useState<number | null>(null);
  const issueRefs = useRef<{ [key: number]: HTMLDivElement | null }>({});

  // Fetch document history on mount
  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    setIsLoadingHistory(true);
    try {
      const response = await fetch("/api/documents");
      let resData;
      try {
        const text = await response.text();
        resData = JSON.parse(text);
      } catch (jsonErr) {
        console.error("Failed to parse history JSON:", jsonErr);
        return;
      }
      if (resData.success) {
        setDocuments(resData.data);
        // Automatically select the most recent document if none is selected
        if (resData.data.length > 0 && !selectedDoc) {
          setSelectedDoc(resData.data[0]);
        }
      }
    } catch (e) {
      console.error("Failed to load document history:", e);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // Drag and Drop handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFilesToQueue(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFilesToQueue(Array.from(e.target.files));
    }
  };

  const addFilesToQueue = (files: File[]) => {
    // Check file types (PDF, Images, DOCX, TXT)
    const validTypes = [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/jpg",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain"
    ];

    const newStatuses: FileUploadStatus[] = files.map(file => {
      const isValid = validTypes.includes(file.type) || file.name.endsWith(".docx");
      return {
        file,
        progress: 0,
        status: isValid ? "idle" : "failed",
        error: isValid ? undefined : "ไม่สนับสนุนประเภทไฟล์นี้ (รองรับ PDF, PNG, JPG, DOCX)"
      };
    });

    setUploadQueue(prev => [...prev, ...newStatuses]);
    setUploadError(null);
  };

  // Remove file from upload list
  const removeFromQueue = (index: number) => {
    setUploadQueue(prev => prev.filter((_, i) => i !== index));
  };

  // Upload and analyze documents
  const startUploadAndAnalysis = async () => {
    const idleFiles = uploadQueue.filter(f => f.status === "idle");
    if (idleFiles.length === 0) return;

    setIsProcessing(true);
    setUploadError(null);

    // Update statuses to uploading
    setUploadQueue(prev =>
      prev.map(f => (f.status === "idle" ? { ...f, status: "uploading", progress: 20 } : f))
    );

    const formData = new FormData();
    idleFiles.forEach(f => {
      formData.append("files", f.file);
    });
    formData.append("model", selectedModel);

    try {
      // Simulate progressive upload visually
      const interval = setInterval(() => {
        setUploadQueue(prev =>
          prev.map(f => {
            if (f.status === "uploading" && f.progress < 90) {
              return { ...f, progress: f.progress + 15 };
            }
            return f;
          })
        );
      }, 400);

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      clearInterval(interval);

      let resData;
      try {
        const text = await response.text();
        resData = JSON.parse(text);
      } catch (jsonErr) {
        throw new Error(
          `เกิดข้อผิดพลาดในการอ่านข้อมูลจากเซิร์ฟเวอร์ (HTTP Status ${response.status}): คาดว่าเกิดจากค่าคงที่ GOOGLE_SERVICE_ACCOUNT_JSON หรือ GEMINI_API_KEY ในหน้า Cloudflare ตั้งค่าไว้ไม่ถูกต้องสมบูรณ์ หรือไม่ได้ผูกฐานข้อมูล D1 Database`
        );
      }

      if (resData.success) {
        // Complete the progress bars
        setUploadQueue(prev =>
          prev.map(f => {
            if (f.status === "uploading") {
              return { ...f, status: "completed", progress: 100 };
            }
            return f;
          })
        );

        // Fetch history and update state
        const updatedDocs = [...resData.data, ...documents];
        setDocuments(updatedDocs);

        // Select the newly uploaded file (usually the first returned)
        if (resData.data.length > 0) {
          setSelectedDoc(resData.data[0]);
        }

        // Clear queue after brief success display
        setTimeout(() => {
          setUploadQueue([]);
        }, 2000);
      } else {
        throw new Error(resData.error || "เกิดข้อผิดพลาดจากเซิร์ฟเวอร์");
      }
    } catch (e: any) {
      console.error(e);
      setUploadError(e.message || "เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์หลังบ้าน");
      setUploadQueue(prev =>
        prev.map(f => (f.status === "uploading" ? { ...f, status: "failed", error: "อัปโหลดล้มเหลว" } : f))
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => {
      setCopiedText(null);
    }, 2000);
  };

  const handleHighlightClick = (index: number) => {
    setSelectedIssueIndex(index);
    const targetElement = issueRefs.current[index];
    if (targetElement) {
      targetElement.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  // Parse stringified issues safely
  const getIssues = (doc: Document): Issue[] => {
    try {
      return JSON.parse(doc.warning_message || "[]");
    } catch (e) {
      return [];
    }
  };

  // Highlighting original words inside extracted text
  const renderHighlightedText = (doc: Document) => {
    const issues = getIssues(doc);
    const text = doc.original_text || "";
    if (issues.length === 0) return <p className="whitespace-pre-wrap leading-relaxed text-gray-700 font-serif leading-8">{text}</p>;

    // Filter unique, non-empty original phrases and sort by length descending to match longest phrases first
    const uniquePhrases = Array.from(
      new Set(
        issues
          .map(i => i.original_phrase ? i.original_phrase.trim() : "")
          .filter(phrase => phrase.length > 0)
      )
    ).sort((a, b) => b.length - a.length);

    if (uniquePhrases.length === 0) {
      return <p className="whitespace-pre-wrap leading-relaxed text-gray-700 font-serif leading-8">{text}</p>;
    }

    // Build a regular expression to match all issues, escaping special regex characters
    const escapedPhrases = uniquePhrases.map(phrase =>
      phrase.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")
    );
    
    // Create a regex with unique captures
    const regex = new RegExp(`(${escapedPhrases.join("|")})`, "g");

    const parts = text.split(regex);
    return (
      <p className="whitespace-pre-wrap leading-relaxed text-gray-700 font-serif leading-8">
        {parts.map((part, index) => {
          // Find if this part matches any of our issues
          const issueIndex = issues.findIndex(i => i.original_phrase === part);
          if (issueIndex !== -1) {
            const isSelected = selectedIssueIndex === issueIndex;
            return (
              <span
                key={index}
                onClick={() => handleHighlightClick(issueIndex)}
                className={`cursor-pointer px-1 rounded-sm border-b-2 font-medium transition-all duration-200 ${
                  isSelected
                    ? "bg-red-200 border-red-600 text-red-900 shadow-sm"
                    : "bg-amber-100 border-amber-500 text-amber-950 hover:bg-amber-200"
                }`}
                title="คลิกเพื่อดูข้อเสนอแนะแก้ไข"
              >
                {part}
                <span className="inline-flex items-center ml-1 text-xs px-1 bg-amber-600 text-white rounded-full scale-90">
                  {issueIndex + 1}
                </span>
              </span>
            );
          }
          return <span key={index}>{part}</span>;
        })}
      </p>
    );
  };

  // Filter history
  const filteredDocuments = documents.filter(doc => {
    const matchesSearch = doc.file_name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter =
      statusFilter === "all" ||
      (statusFilter === "pass" && doc.status === "pass") ||
      (statusFilter === "fail" && doc.status === "fail");
    return matchesSearch && matchesFilter;
  });

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
      {/* 1. Header Bar with PEA Purple identity */}
      <header className="bg-gradient-to-r from-pea-purple-800 to-pea-purple-600 text-white shadow-md">
        <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-pea-yellow text-pea-purple-900 font-extrabold px-3 py-1.5 rounded-lg shadow-inner text-lg tracking-wider">
              กฟภ.
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold tracking-tight">
                PEA Letter Verifier
              </h1>
              <p className="text-xs text-pea-purple-100 font-light flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-pea-yellow fill-pea-yellow" />
                ระบบปัญญาประดิษฐ์ตรวจสอบจดหมายและบันทึกข้อความราชการ กฟภ.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <div className="bg-pea-purple-900/50 border border-pea-purple-400/20 px-3 py-1 rounded-lg flex items-center gap-2 text-pea-purple-100">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-medium whitespace-nowrap text-pea-purple-200">โมเดล:</span>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="bg-transparent border-none text-white font-bold focus:ring-0 focus:outline-hidden cursor-pointer p-0 text-xs text-center outline-hidden [color-scheme:dark]"
              >
                <option value="gemini-2.5-flash" className="text-gray-900 bg-white">Gemini 2.5 Flash (แนะนำ / เร็วมาก)</option>
                <option value="gemini-1.5-flash" className="text-gray-900 bg-white">Gemini 1.5 Flash (โควตาสูง)</option>
                <option value="gemini-2.5-pro" className="text-gray-900 bg-white">Gemini 2.5 Pro (ละเอียดสูง)</option>
                <option value="gemini-1.5-pro" className="text-gray-900 bg-white">Gemini 1.5 Pro (มาตรฐาน)</option>
                <option value="gemini-3.1-pro-preview" className="text-gray-900 bg-white">Gemini 3.1 Pro (โมเดลใหม่)</option>
              </select>
            </div>
            <div className="bg-pea-purple-900/50 border border-pea-purple-400/20 px-3 py-1.5 rounded-full flex items-center gap-2 text-pea-purple-100">
              <Database className="w-3.5 h-3.5 text-pea-yellow" />
              <span>D1 Cloudflare SQLite Connected</span>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Intro banner */}
      <section className="bg-pea-purple-50 border-b border-pea-purple-100/50 py-6 px-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="max-w-3xl">
            <h2 className="text-lg font-bold text-pea-purple-900 flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-pea-purple-600" />
              ระเบียบงานสารบรรณและการเขียนหนังสือราชการ กฟภ.
            </h2>
            <p className="text-sm text-gray-600 mt-1.5 leading-relaxed">
              ช่วยตรวจสอบจดหมายอย่างชาญฉลาดและถูกต้อง ค้นหาข้อผิดพลาดของอักขรวิธี, คำทับศัพท์ตามหลักราชบัณฑิตยสภา, 
              ระดับภาษาทางการที่ขาดความเหมาะสม รวมถึงสไตล์โครงสร้างแบบฟอร์มบันทึกข้อความ กฟภ. โดยสรุปจุดบกพร่องพร้อมให้ประโยคที่ถูกต้องสมบูรณ์ทันที
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab("workspace")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                activeTab === "workspace"
                  ? "bg-pea-purple-700 text-white shadow-md"
                  : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"
              }`}
            >
              หน้ากระดานหลัก
            </button>
            <button
              onClick={() => setActiveTab("history")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 ${
                activeTab === "history"
                  ? "bg-pea-purple-700 text-white shadow-md"
                  : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"
              }`}
            >
              <History className="w-4 h-4" />
              ประวัติ ({documents.length})
            </button>
          </div>
        </div>
      </section>

      {/* Main Workspace Layout */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {activeTab === "workspace" ? (
          <>
            {/* LEFT / TOP SIDEBAR - Workspace upload and list */}
            <div className="lg:col-span-4 flex flex-col gap-6">
              {/* Drag and Drop Zone */}
              <div className="bg-white rounded-xl shadow-xs border border-gray-100 p-5">
                <h3 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <FileUp className="w-4.5 h-4.5 text-pea-purple-600" />
                  นำเข้าหนังสือราชการ (สูงสุด 25MB)
                </h3>

                <div
                  onDragEnter={handleDrag}
                  onDragOver={handleDrag}
                  onDragLeave={handleDrag}
                  onDrop={handleDrop}
                  className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-200 ${
                    dragActive
                      ? "border-pea-purple-500 bg-pea-purple-50/50 scale-98"
                      : "border-gray-200 hover:border-pea-purple-300 hover:bg-gray-50"
                  }`}
                  onClick={() => document.getElementById("file-input")?.click()}
                >
                  <input
                    type="file"
                    id="file-input"
                    multiple
                    accept=".pdf,.png,.jpg,.jpeg,.docx,.txt"
                    className="hidden"
                    onChange={handleFileSelect}
                  />

                  <UploadCloud className="w-12 h-12 text-pea-purple-400 mb-3" />
                  <p className="text-sm font-medium text-gray-800">
                    วางไฟล์เพื่ออัปโหลด หรือ <span className="text-pea-purple-600 underline">คลิกเลือกไฟล์</span>
                  </p>
                  <p className="text-xs text-gray-400 mt-2">
                    รองรับไฟล์ PDF, PNG, JPG, DOCX และ TXT
                  </p>
                </div>

                {/* Queue display */}
                {uploadQueue.length > 0 && (
                  <div className="mt-4 border-t border-gray-100 pt-4">
                    <h4 className="text-xs font-semibold text-gray-500 mb-2.5">
                      รายการเตรียมพร้อมส่งวิเคราะห์ ({uploadQueue.length} ไฟล์)
                    </h4>
                    <div className="flex flex-col gap-2 max-h-48 overflow-y-auto pr-1">
                      {uploadQueue.map((status, index) => (
                        <div
                          key={index}
                          className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg border border-gray-100 text-xs gap-3"
                        >
                          <div className="flex items-center gap-2 overflow-hidden flex-1">
                            <FileText className="w-4 h-4 text-pea-purple-500 shrink-0" />
                            <span className="truncate text-gray-700 font-medium" title={status.file.name}>
                              {status.file.name}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {status.status === "idle" && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeFromQueue(index);
                                }}
                                className="text-gray-400 hover:text-red-500 font-bold px-1.5 py-0.5 rounded-sm"
                              >
                                ✕
                              </button>
                            )}

                            {status.status === "uploading" && (
                              <div className="w-16 bg-gray-200 rounded-full h-1.5 overflow-hidden">
                                <div
                                  className="bg-pea-purple-600 h-1.5 rounded-full transition-all duration-300"
                                  style={{ width: `${status.progress}%` }}
                                />
                              </div>
                            )}

                            {status.status === "completed" && (
                              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                            )}

                            {status.status === "failed" && (
                              <div className="flex items-center gap-1 text-red-500" title={status.error}>
                                <XCircle className="w-4 h-4 shrink-0" />
                                <span className="scale-75 font-semibold">ล้มเหลว</span>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    <button
                      onClick={startUploadAndAnalysis}
                      disabled={isProcessing}
                      className="w-full mt-4 bg-pea-purple-700 hover:bg-pea-purple-800 text-white py-2.5 px-4 rounded-lg font-medium shadow-md flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isProcessing ? (
                        <>
                          <RefreshCw className="w-4.5 h-4.5 animate-spin" />
                          <span>กำลังอัปโหลดและประมวลผลด้วย AI...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4.5 h-4.5 text-pea-yellow fill-pea-yellow" />
                          <span>ตรวจพิสูจน์หนังสือราชการด้วย AI</span>
                        </>
                      )}
                    </button>
                  </div>
                )}

                {uploadError && (
                  <div className="mt-3 p-3 bg-red-50 border border-red-100 text-red-700 rounded-lg text-xs flex gap-2 items-start">
                    <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{uploadError}</span>
                  </div>
                )}
              </div>

              {/* Guide configuration panel */}
              <div className="bg-white rounded-xl shadow-xs border border-gray-100 p-5 text-xs text-gray-600">
                <h4 className="font-bold text-gray-800 flex items-center gap-1.5 mb-2.5">
                  <Info className="w-4 h-4 text-pea-purple-600 shrink-0" />
                  การประมวลผลและการบันทึกข้อมูล
                </h4>
                <div className="bg-emerald-50 border border-emerald-100 text-emerald-800 p-3 rounded-lg mb-3">
                  <p className="font-semibold flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    โหมดตรวจสอบแบบด่วนโดยตรง
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-emerald-700">
                    เพื่อความรวดเร็วและหลีกเลี่ยงข้อจำกัดโควตาพื้นที่เก็บข้อมูล Google Drive ของผู้ใช้ ระบบจะทำการวิเคราะห์ความถูกต้องเชิงภาษาและระดับอักษรศาสตร์ด้วย AI โดยตรงทันที และบันทึกผลลัพธ์พร้อมประวัติการตรวจลงในระบบฐานข้อมูลคลาวด์ D1 ของ กฟภ. อย่างมั่นคงและปลอดภัย
                  </p>
                </div>
                <div className="flex items-center justify-between text-gray-400 text-[11px] pt-1">
                  <span>สถานะระบบ:</span>
                  <span className="bg-emerald-50 text-emerald-700 px-2.5 py-0.5 rounded-full text-[10px] font-semibold border border-emerald-100">
                    วิเคราะห์โดยตรง 100%
                  </span>
                </div>
              </div>
            </div>

            {/* RIGHT SIDE / MAIN ANALYSIS - Live Results Display */}
            <div className="lg:col-span-8 flex flex-col gap-6">
              {selectedDoc ? (
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  {/* Selected Document Header */}
                  <div className="bg-gradient-to-r from-gray-50 to-white px-5 py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 font-medium font-mono uppercase bg-gray-100 px-2 py-0.5 rounded">
                          {selectedDoc.file_type.split("/")[1] || "DOC"}
                        </span>
                        <h2 className="text-base font-bold text-gray-900 truncate max-w-xs md:max-w-md">
                          {selectedDoc.file_name}
                        </h2>
                      </div>
                      <p className="text-[11px] text-gray-400 mt-1 flex items-center gap-1">
                        <span>ประมวลผลเมื่อ: {new Date(selectedDoc.created_at).toLocaleString("th-TH")}</span>
                      </p>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0">
                      {selectedDoc.google_drive_link && selectedDoc.google_drive_link.startsWith("http") && (
                        <a
                          href={selectedDoc.google_drive_link}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-pea-purple-700 border border-pea-purple-200 hover:bg-pea-purple-50 px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5 transition-colors"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          ดูใน Google Drive
                        </a>
                      )}

                      {selectedDoc.status === "pass" ? (
                        <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                          ผ่านทุกระเบียบ
                        </span>
                      ) : (
                        <span className="bg-amber-50 text-amber-800 border border-amber-200 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5">
                          <AlertTriangle className="w-4 h-4 text-amber-500" />
                          พบข้อผิดพลาด ({getIssues(selectedDoc).length} จุด)
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Warning banner for failed Google Drive upload due to April 2025 Google Service Account quota policy changes */}
                  {selectedDoc.google_drive_link?.startsWith("FAILED_UPLOAD:") && (
                    <div className="mx-5 mt-4 p-4 bg-amber-50/80 border border-amber-200 rounded-xl text-xs text-amber-900 flex gap-3 shadow-xs">
                      <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                      <div className="space-y-1.5">
                        <h5 className="font-bold text-amber-950 flex items-center gap-1.5">
                          ⚠️ ตรวจพบข้อผิดพลาดขณะส่งไฟล์ขึ้น Google Drive แต่ระบบยังคงดำเนินการตรวจสอบภาษาด้วย AI สำเร็จตามปกติ!
                        </h5>
                        <p className="leading-relaxed">
                          เนื่องจากนโยบายใหม่ของ Google (เริ่มใช้ เมษายน 2568) **Service Account ใหม่จะมีพื้นที่จัดเก็บเท่ากับ 0 GB (Quota Limit)** ทำให้ไม่สามารถอัปโหลดไฟล์ไปยังไดรฟ์ส่วนบุคคลทั่วไปได้โดยตรง (จะเกิดข้อผิดพลาด Quota Exceeded เสมอ แม้แชร์สิทธิ์เป็นผู้แก้ไขแล้วก็ตาม)
                        </p>
                        <div className="bg-white/60 p-2.5 rounded-lg border border-amber-100/70 text-[11px] leading-relaxed mt-1 text-gray-700">
                          <p className="font-bold text-amber-950 mb-1">💡 ทางเลือกเพื่อเปิดใช้งาน Google Drive:</p>
                          <ol className="list-decimal pl-4 space-y-1">
                            <li>หากต้องการบันทึกไฟล์ลง Drive จริงๆ คุณต้องใช้ **Shared Drive (ไดรฟ์แชร์)** ของบัญชีองค์กร Google Workspace จากนั้นแชร์สิทธิ์แบบ "ผู้ส่งเนื้อหา" (Contributor) ให้กับอีเมล Service Account นี้ และกำหนด ID ของโฟลเดอร์ใน Shared Drive นั้น</li>
                            <li>หรือใช้งานระบบตรวจภาษาแบบเป็นมิตรโดยตรง (ไม่ต้องใช้ Google Drive) เนื่องจากตัวแอปจะตรวจคำผิดด้วยโมเดล Gemini และบันทึกผลลงในฐานข้อมูล D1 ท้องถิ่นอยู่แล้วอย่างสมบูรณ์</li>
                          </ol>
                        </div>
                        <p className="text-[10px] text-amber-700/80 pt-1 font-mono">
                          ข้อผิดพลาดทางเทคนิค: {selectedDoc.google_drive_link.replace("FAILED_UPLOAD:", "").trim()}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Split Workspace Editor View */}
                  <div className="grid grid-cols-1 xl:grid-cols-12 divide-y xl:divide-y-0 xl:divide-x divide-gray-100 min-h-[500px]">
                    
                    {/* Raw Text Highlight view */}
                    <div className="xl:col-span-6 p-5 overflow-y-auto max-h-[600px] bg-slate-50/50">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-bold text-gray-500 tracking-wider uppercase">
                          ข้อความต้นฉบับในเอกสาร
                        </span>
                        <span className="text-[10px] text-gray-400">
                          (คำไฮไลต์สีส้มคือข้อผิดพลาดคลิกเพื่อข้ามไปดูคำอธิบาย)
                        </span>
                      </div>
                      <div className="bg-white p-5 rounded-lg border border-gray-100 shadow-inner">
                        {renderHighlightedText(selectedDoc)}
                      </div>
                    </div>

                    {/* Correction / Recommendation details view */}
                    <div className="xl:col-span-6 p-5 flex flex-col gap-4 overflow-y-auto max-h-[600px]">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-gray-500 tracking-wider uppercase">
                          การแจ้งเตือนและการเสนอแนะแก้ไขเชิงอักษรศาสตร์
                        </span>
                      </div>

                      {/* Explicit Warning Notification Box list */}
                      {getIssues(selectedDoc).length > 0 ? (
                        <div className="flex flex-col gap-4">
                          {getIssues(selectedDoc).map((issue, idx) => {
                            const isFocused = selectedIssueIndex === idx;
                            return (
                              <div
                                key={idx}
                                ref={el => (issueRefs.current[idx] = el)}
                                className={`border rounded-xl p-4 transition-all duration-200 relative ${
                                  isFocused
                                    ? "border-red-500 bg-red-50/30 ring-2 ring-red-500/10 scale-[1.01]"
                                    : "border-amber-200 bg-amber-50/15 hover:bg-amber-50/30"
                                }`}
                              >
                                {/* Badge and Title */}
                                <div className="flex items-start justify-between gap-2 mb-2">
                                  <div className="flex items-center gap-2">
                                    <span className="flex items-center justify-center w-5 h-5 bg-pea-purple-100 text-pea-purple-800 rounded-full text-xs font-bold font-mono">
                                      {idx + 1}
                                    </span>
                                    <span className="bg-amber-100 text-amber-800 text-[10px] px-2 py-0.5 rounded-full font-bold">
                                      {issue.issue_type}
                                    </span>
                                  </div>
                                  <span className="text-[10px] text-gray-400 font-medium">
                                    ระเบียบงานสารบรรณ กฟภ.
                                  </span>
                                </div>

                                {/* Comparison Grid */}
                                <div className="grid grid-cols-2 gap-4 my-3 text-xs bg-white p-2.5 rounded-lg border border-gray-100 shadow-xs">
                                  <div className="border-r border-gray-100 pr-2">
                                    <span className="text-gray-400 block mb-0.5">คำ/ประโยคเดิม:</span>
                                    <span className="text-red-600 line-through font-medium block break-words">
                                      {issue.original_phrase}
                                    </span>
                                  </div>
                                  <div className="pl-1">
                                    <span className="text-emerald-600 block font-bold mb-0.5">✓ ประโยคที่เสนอแก้ไข:</span>
                                    <span className="text-emerald-800 font-semibold block break-words">
                                      {issue.corrected_phrase}
                                    </span>
                                  </div>
                                </div>

                                {/* Grammatical explanation */}
                                <div className="text-xs text-gray-600 leading-relaxed bg-gray-50/50 p-2.5 rounded-lg border border-gray-100 mb-3">
                                  <strong className="text-gray-700 block mb-1 font-semibold flex items-center gap-1">
                                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                    รายละเอียดและหลักอักษรศาสตร์:
                                  </strong>
                                  {issue.warning_description}
                                </div>

                                {/* Copy Correct Phrase container */}
                                <div className="flex items-center justify-between gap-4 bg-emerald-50/50 border border-emerald-200/50 rounded-lg p-2.5">
                                  <code className="text-xs text-emerald-950 font-medium break-all flex-1">
                                    {issue.corrected_phrase}
                                  </code>
                                  <button
                                    onClick={() => copyToClipboard(issue.corrected_phrase, `phrase-${idx}`)}
                                    className="shrink-0 text-xs bg-white hover:bg-emerald-100 text-emerald-800 border border-emerald-200 px-3 py-1.5 rounded-md font-bold flex items-center gap-1 transition-all duration-150 cursor-pointer shadow-xs active:scale-95"
                                  >
                                    {copiedText === `phrase-${idx}` ? (
                                      <>
                                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                                        คัดลอกแล้ว!
                                      </>
                                    ) : (
                                      <>
                                        <Copy className="w-3.5 h-3.5" />
                                        คัดลอกส่วนนี้
                                      </>
                                    )}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center py-16 text-center">
                          <CheckCircle2 className="w-16 h-16 text-emerald-400 mb-3.5 animate-pulse" />
                          <h4 className="text-base font-bold text-gray-800">จดหมายสมบูรณ์แบบร้อยเปอร์เซ็นต์!</h4>
                          <p className="text-xs text-gray-500 mt-1 max-w-xs leading-relaxed">
                            ระบบ AI ตรวจไม่พบคำผิด คำสแลง หรือรูปแบบที่ขัดแย้งต่อระเบียบสารบรรณของ กฟภ. เอกสารนี้พร้อมนำเสนออนุมัติ
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 4. Full Draft Corrected view container at the bottom */}
                  <div className="bg-pea-purple-50/35 border-t border-gray-100 p-5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                      <div>
                        <h4 className="text-sm font-bold text-pea-purple-900 flex items-center gap-2">
                          <BookOpen className="w-4.5 h-4.5" />
                          ฉบับร่างแก้ไขที่ถูกต้องสมบูรณ์แบบทางการ (Draft of Corrected Letter)
                        </h4>
                        <p className="text-xs text-gray-500 mt-0.5">
                          นี่คือจดหมายราชการฉบับเต็มของท่านหลังผ่านการแก้ไขเรียงร้อยโครงสร้างคำผิดตามระเบียบงานสารบรรณ กฟภ. พ.ศ. 2565 ทุกจุดแล้ว
                        </p>
                      </div>

                      <button
                        onClick={() => copyToClipboard(selectedDoc.recommended_text, "full-draft")}
                        className="bg-pea-purple-700 hover:bg-pea-purple-800 text-white text-xs py-2 px-4 rounded-lg font-bold flex items-center gap-1.5 shadow-sm transition-all duration-150 shrink-0 cursor-pointer active:scale-95"
                      >
                        {copiedText === "full-draft" ? (
                          <>
                            <Check className="w-4 h-4 text-pea-yellow" />
                            คัดลอกแบบร่างทั้งหมดสำเร็จ!
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4" />
                            คัดลอกร่างจดหมายทั้งหมด
                          </>
                        )}
                      </button>
                    </div>

                    <div className="bg-white p-6 rounded-xl border border-pea-purple-100 shadow-sm font-serif text-sm leading-8 text-gray-800 max-h-72 overflow-y-auto whitespace-pre-wrap select-all">
                      {selectedDoc.recommended_text}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-xl shadow-xs border border-gray-100 p-12 text-center flex flex-col items-center justify-center min-h-[500px]">
                  <div className="bg-pea-purple-50 p-4 rounded-full mb-4">
                    <FileText className="w-12 h-12 text-pea-purple-400" />
                  </div>
                  <h3 className="text-base font-bold text-gray-900">ยังไม่ได้ระบุเอกสารในการตรวจสอบ</h3>
                  <p className="text-xs text-gray-500 mt-1.5 max-w-sm leading-relaxed">
                    ลากไฟล์จดหมายราชการ (เช่น PDF ของบันทึกข้อความ, รูปจดหมายราชการ, หรือไฟล์ DOCX) เข้ามาที่กล่องฝั่งซ้าย แล้วคลิกเริ่มตรวจเพื่อวิเคราะห์ข้อมูล
                  </p>
                </div>
              )}
            </div>
          </>
        ) : (
          /* HISTORY PANEL VIEW */
          <div className="lg:col-span-12 bg-white rounded-xl shadow-xs border border-gray-100 p-5 min-h-[600px] flex flex-col">
            {/* Header / Filter row */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-100 pb-5 mb-5">
              <div>
                <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                  <History className="w-5 h-5 text-pea-purple-700" />
                  ประวัติผลการตรวจสอบทั้งหมด ({filteredDocuments.length})
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  รายการหนังสือราชการที่ผ่านการคัดกรองด้วยโครงสร้างฐานข้อมูล Cloudflare D1
                </p>
              </div>

              {/* Controls */}
              <div className="flex flex-wrap items-center gap-3">
                {/* Search */}
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400 pointer-events-none">
                    <Search className="w-4 h-4" />
                  </span>
                  <input
                    type="text"
                    placeholder="ค้นหาตามชื่อไฟล์..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="bg-gray-50 border border-gray-200 text-xs rounded-lg pl-9 pr-4 py-2.5 w-64 focus:outline-none focus:ring-2 focus:ring-pea-purple-500 text-gray-700 font-medium"
                  />
                </div>

                {/* Filter */}
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                  className="bg-gray-50 border border-gray-200 text-xs rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-pea-purple-500 text-gray-700 font-medium cursor-pointer"
                >
                  <option value="all">ผลตรวจสอบทั้งหมด</option>
                  <option value="pass">ผ่านเกณฑ์ (Pass)</option>
                  <option value="fail">มีจุดต้องแก้ไข (Fail)</option>
                </select>

                {/* Refresh */}
                <button
                  onClick={fetchHistory}
                  disabled={isLoadingHistory}
                  className="bg-gray-100 hover:bg-gray-200 text-gray-600 disabled:opacity-50 p-2.5 rounded-lg transition-colors cursor-pointer"
                  title="รีเฟรชประวัติ"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoadingHistory ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>

            {/* List Row */}
            {isLoadingHistory ? (
              <div className="flex-1 flex flex-col items-center justify-center py-24">
                <RefreshCw className="w-8 h-8 text-pea-purple-600 animate-spin mb-3" />
                <p className="text-sm text-gray-500">กำลังดึงฐานข้อมูล Cloudflare D1...</p>
              </div>
            ) : filteredDocuments.length > 0 ? (
              <div className="flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 overflow-y-auto pr-1">
                {filteredDocuments.map((doc) => {
                  const issues = getIssues(doc);
                  return (
                    <div
                      key={doc.id}
                      onClick={() => {
                        setSelectedDoc(doc);
                        setActiveTab("workspace");
                      }}
                      className="border border-gray-100 hover:border-pea-purple-300 hover:shadow-md rounded-xl p-4 cursor-pointer transition-all duration-200 bg-white hover:bg-pea-purple-50/5 flex flex-col justify-between group relative"
                    >
                      <div>
                        {/* Status Icon & Filename */}
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-2.5 overflow-hidden">
                            <FileText className="w-5 h-5 text-pea-purple-600 shrink-0 mt-0.5" />
                            <div className="overflow-hidden">
                              <h4 className="text-xs font-bold text-gray-800 truncate group-hover:text-pea-purple-900 transition-colors">
                                {doc.file_name}
                              </h4>
                              <span className="text-[9px] text-gray-400 font-mono mt-0.5 block uppercase">
                                {doc.file_type.split("/")[1] || "document"}
                              </span>
                            </div>
                          </div>

                          <span className="shrink-0">
                            {doc.status === "pass" ? (
                              <CheckCircle2 className="w-4.5 h-4.5 text-emerald-500" />
                            ) : (
                              <AlertTriangle className="w-4.5 h-4.5 text-amber-500" />
                            )}
                          </span>
                        </div>

                        {/* Summary description */}
                        <div className="mt-3.5 text-xs text-gray-500 leading-relaxed line-clamp-3">
                          {doc.original_text}
                        </div>
                      </div>

                      {/* Footer Info */}
                      <div className="mt-5 pt-3.5 border-t border-gray-100 flex items-center justify-between text-[10px]">
                        <span className="text-gray-400">
                          {new Date(doc.created_at).toLocaleDateString("th-TH")} {new Date(doc.created_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
                        </span>

                        <span className="font-bold flex items-center gap-0.5 text-pea-purple-700">
                          เปิดเวิร์กสเปซ
                          <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center py-24 text-center">
                <FileText className="w-16 h-16 text-gray-300 mb-3" />
                <h4 className="text-sm font-semibold text-gray-800">ไม่พบรายการผลการตรวจ</h4>
                <p className="text-xs text-gray-400 mt-1 max-w-xs">
                  ยังไม่มีประวัติในขณะนี้ หรือผลการค้นหาไม่ตรงกับเงื่อนไขใด ๆ เลย
                </p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
