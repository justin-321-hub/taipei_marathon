/**
 * app.js — 前端純 JS 聊天室邏輯（無框架）
 * ---------------------------------------------------------
 * 功能重點：
 * 1) 基本訊息串接與渲染（使用者/機器人）
 * 2) 免登入多使用者：以 localStorage 建立 clientId
 * 3) 思考中動畫控制（輸入禁用/解禁）
 * 4) 呼叫後端 /api/chat，強化回應解析與錯誤處理
 * 5) ★ 修正：解決重複回應問題，統一處理空值邏輯
 * 6) ★ 防止重複發送和重複回應
 *
 * 依賴：
 * - 頁面需有以下元素：
 *   #messages, #txtInput, #btnSend, #thinking
 */

"use strict";

/* =========================
   後端 API 網域（可依環境調整）
   ========================= */
const API_BASE = "https://taipei-marathon-server.onrender.com";
const api = (p) => `${API_BASE}${p}`;

/* =========================
   免登入多使用者：clientId
   - 以 localStorage 永續化
   - 預設使用 crypto.randomUUID()，若不支援則以時間戳+隨機碼
   ========================= */
const CID_KEY = "fourleaf_client_id";
let clientId = localStorage.getItem(CID_KEY);
if (!clientId) {
  clientId =
    (crypto.randomUUID && crypto.randomUUID()) ||
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(CID_KEY, clientId);
}

/* =========================
   DOM 參照
   ========================= */
const elMessages = document.getElementById("messages");
const elInput = document.getElementById("txtInput");
const elBtnSend = document.getElementById("btnSend");
const elThinking = document.getElementById("thinking");

/* =========================
   訊息狀態（簡易記憶體）
   ========================= */
/** @type {{id:string, role:'user'|'assistant', text:string, ts:number}[]} */
const messages = [];

/* =========================
   防止重複發送的標記
   ========================= */
let isSending = false;

/* =========================
   小工具
   ========================= */
const uid = () => Math.random().toString(36).slice(2);
function scrollToBottom() {
  elMessages?.scrollTo({ top: elMessages.scrollHeight, behavior: "smooth" });
}

/**
 * 切換「思考中」動畫與輸入狀態
 */
function setThinking(on) {
  if (!elThinking) return;
  if (on) {
    elThinking.classList.remove("hidden");
    if (elBtnSend) elBtnSend.disabled = true;
    if (elInput) elInput.disabled = true;
  } else {
    elThinking.classList.add("hidden");
    if (elBtnSend) elBtnSend.disabled = false;
    if (elInput) elInput.disabled = false;
    elInput?.focus();
  }
}

/* =========================
   將 messages 渲染到畫面
   ========================= */
function render() {
  if (!elMessages) return;
  elMessages.innerHTML = "";

  for (const m of messages) {
    const isUser = m.role === "user";

    // 外層一列
    const row = document.createElement("div");
    row.className = `msg ${isUser ? "user" : "bot"}`;

    // 頭像
    const avatar = document.createElement("img");
    avatar.className = "avatar";
    avatar.src = isUser
      ? 'https://raw.githubusercontent.com/justin-321-hub/taipei_marathon/refs/heads/main/assets/user-avatar.png'
      : 'https://raw.githubusercontent.com/justin-321-hub/taipei_marathon/refs/heads/main/assets/logo.png';
    avatar.alt = isUser ? "you" : "bot";

    // 對話泡泡
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.innerText = m.text;

    // 組合
    row.appendChild(avatar);
    row.appendChild(bubble);
    elMessages.appendChild(row);
  }

  scrollToBottom();
}

/* =========================
   處理機器人回應文字的邏輯
   ★ 重構：獨立函數，避免重複判斷
   ========================= */
function extractBotReply(data, raw) {
  // 1. 如果 data 是純字串
  if (typeof data === "string") {
    const trimmed = data.trim();
    return trimmed || "請換個說法，謝謝您";
  }

  // 2. 如果 data 不是物件或是 null/undefined
  if (!data || typeof data !== "object") {
    return "請換個說法，謝謝您";
  }

  // 3. 處理物件類型的 data
  // 優先檢查 text 欄位，其次檢查 message 欄位
  let textContent = null;
  
  if ('text' in data) {
    textContent = data.text;
  } else if ('message' in data) {
    textContent = data.message;
  }

  // 如果找到了 text 或 message 欄位
  if (textContent !== null) {
    // 轉換為字串並修剪空白
    const processed = String(textContent).trim();
    return processed || "請換個說法，謝謝您";
  }

  // 4. 沒有 text 或 message 欄位的情況
  // 檢查是否為空物件（忽略 clientId）
  const meaningfulKeys = Object.keys(data).filter(k => k !== 'clientId');
  
  if (meaningfulKeys.length === 0) {
    // 空物件或只有 clientId
    return "網路不穩定，請再試一次";
  }

  // 5. 有其他欄位但沒有 text/message（便於除錯）
  // 如果有 error 相關欄位，優先顯示
  if (data.error) {
    return String(data.error);
  }
  
  if (data.errorRaw) {
    return "伺服器回應格式錯誤，請稍後再試";
  }

  // 6. 其他情況，顯示 JSON（開發除錯用）
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return "系統回應異常，請稍後再試";
  }
}

/* =========================
   呼叫後端，並顯示雙方訊息
   ========================= */
async function sendText(text) {
  // 防止重複發送
  if (isSending) {
    console.log("正在發送中，忽略重複請求");
    return;
  }

  const content = (text ?? elInput?.value ?? "").trim();
  if (!content) return;

  // 設置發送狀態
  isSending = true;

  try {
    // 先插入使用者訊息到畫面
    const userMsg = { 
      id: uid(), 
      role: "user", 
      text: content, 
      ts: Date.now() 
    };
    messages.push(userMsg);
    if (elInput) elInput.value = "";
    render();

    // 進入思考中
    setThinking(true);

    // 呼叫後端 /api/chat
    const res = await fetch(api("/api/chat"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Client-Id": clientId,
      },
      body: JSON.stringify({ 
        text: content, 
        clientId, 
        language: "繁體中文" 
      }),
    });

    // 以文字讀回
    const raw = await res.text();

    // 嘗試 JSON 解析
    let data;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch (e) {
      console.error("JSON 解析失敗:", e);
      data = { errorRaw: raw };
    }

    // HTTP 狀態非 2xx 時，直接丟錯
    if (!res.ok) {
      if (res.status === 502 || res.status === 404) {
        throw new Error("網路不穩定，請再試一次!");
      }

      const serverMsg =
        (data && (data.error || data.body || data.message)) ?? 
        raw ?? 
        "unknown error";
      throw new Error(`HTTP ${res.status} ${res.statusText} — ${serverMsg}`);
    }

    // ★ 使用統一的處理函數取得回應文字
    const replyText = extractBotReply(data, raw);

    // 推入機器人訊息（只推入一次！）
    const botMsg = { 
      id: uid(), 
      role: "assistant", 
      text: replyText, 
      ts: Date.now() 
    };
    messages.push(botMsg);
    
    // 關閉思考中並渲染
    setThinking(false);
    render();

  } catch (err) {
    console.error("發送訊息錯誤:", err);
    
    // 發生錯誤時也要關閉思考動畫
    setThinking(false);

    // 統一錯誤訊息格式
    const friendly =
      (!navigator.onLine && "目前處於離線狀態，請檢查網路連線後再試一次") ||
      `${err?.message || err}`;

    const botErr = {
      id: uid(),
      role: "assistant",
      text: friendly,
      ts: Date.now(),
    };
    messages.push(botErr);
    render();
    
  } finally {
    // 無論成功或失敗，都要重置發送狀態
    isSending = false;
  }
}

/* =========================
   事件綁定
   ========================= */
let eventsAttached = false;

function attachEvents() {
  if (eventsAttached) {
    console.log("事件已經綁定，跳過重複綁定");
    return;
  }

  // 按鈕點擊送出
  elBtnSend?.addEventListener("click", (e) => {
    e.preventDefault();
    sendText();
  });

  // Enter 送出（Shift+Enter 換行）
  elInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendText();
    }
  });

  eventsAttached = true;
  console.log("事件綁定完成");
}

// 確保頁面載入完成後才綁定事件
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    attachEvents();
    elInput?.focus();
  });
} else {
  attachEvents();
  elInput?.focus();
}

/* =========================
   初始化歡迎訊息
   ========================= */
if (messages.length === 0) {
  messages.push({
    id: uid(),
    role: "assistant",
    text: "歡迎來到臺北馬拉松智慧客服！\n我是小幫手，隨時為您解答~ 有什麼問題可以為您解答的嗎?",
    ts: Date.now(),
  });
  render();
}