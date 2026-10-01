const STORAGE_KEY = "commonplace.aiml.chats.v1";
const FALLBACK_REPLY = "I don't have a rule for that just yet. Try asking what I can do, or tell me a little more.";

const elements = {
  sidebar: document.querySelector("#sidebar"),
  sidebarScrim: document.querySelector("#sidebar-scrim"),
  conversationList: document.querySelector("#conversation-list"),
  conversation: document.querySelector("#conversation"),
  welcome: document.querySelector("#welcome"),
  messages: document.querySelector("#messages"),
  form: document.querySelector("#chat-form"),
  input: document.querySelector("#message-input"),
  send: document.querySelector("#send-button"),
  status: document.querySelector("#engine-status"),
  toast: document.querySelector("#toast"),
};

let chats = loadChats();
let currentChatId = null;
let categories = [];
let toastTimeout;

function loadChats() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(saved) ? saved.filter((chat) => chat && Array.isArray(chat.messages)) : [];
  } catch {
    return [];
  }
}

function saveChats() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
}

function normalize(text) {
  return text.toUpperCase().replace(/[^A-Z0-9*_\s]/g, " ").replace(/\s+/g, " ").trim();
}

function compilePattern(pattern) {
  const tokens = normalize(pattern).split(" ").filter(Boolean);
  let wildcardCount = 0;
  let fixedCount = 0;
  let expression = "^";

  tokens.forEach((token, index) => {
    if (index > 0) expression += "\\s+";
    if (token === "*" || token === "_") {
      expression += "(.*?)";
      wildcardCount += 1;
    } else {
      expression += token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      fixedCount += 1;
    }
  });

  return { expression: new RegExp(`${expression}$`), wildcardCount, fixedCount };
}

function collectCategories(xmlText) {
  const documentNode = new DOMParser().parseFromString(xmlText, "application/xml");
  if (documentNode.querySelector("parsererror")) throw new Error("The AIML rules file could not be read.");

  return [...documentNode.querySelectorAll("category")]
    .map((node, order) => {
      const pattern = node.querySelector(":scope > pattern")?.textContent || "";
      const template = node.querySelector(":scope > template");
      return { ...compilePattern(pattern), template, order };
    })
    .filter((category) => category.template)
    .sort((left, right) => right.fixedCount - left.fixedCount || left.wildcardCount - right.wildcardCount || left.order - right.order);
}

function renderTemplate(node, stars) {
  return [...node.childNodes].map((child) => {
    if (child.nodeType === Node.TEXT_NODE) return child.textContent;
    if (child.nodeType !== Node.ELEMENT_NODE) return "";

    const tag = child.tagName.toLowerCase();
    if (tag === "star") {
      const index = Number(child.getAttribute("index") || "1") - 1;
      return stars[index] || "";
    }
    if (tag === "random") {
      const choices = [...child.children].filter((choice) => choice.tagName.toLowerCase() === "li");
      const choice = choices[Math.floor(Math.random() * choices.length)];
      return choice ? renderTemplate(choice, stars) : "";
    }
    if (tag === "bot") return "Commonplace";
    if (tag === "br") return "\n";
    return renderTemplate(child, stars);
  }).join("").replace(/\s+/g, " ").trim();
}

function getReply(message) {
  const input = normalize(message);
  for (const category of categories) {
    const match = input.match(category.expression);
    if (match) return renderTemplate(category.template, match.slice(1));
  }
  return FALLBACK_REPLY;
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getCurrentChat() {
  return chats.find((chat) => chat.id === currentChatId);
}

function renderHistory() {
  elements.conversationList.replaceChildren();
  const sorted = [...chats].sort((left, right) => right.updatedAt - left.updatedAt);

  sorted.forEach((chat) => {
    const item = document.createElement("div");
    item.className = "history-row";

    const openButton = document.createElement("button");
    openButton.className = `history-item${chat.id === currentChatId ? " active" : ""}`;
    openButton.type = "button";
    openButton.setAttribute("aria-label", `Open ${chat.title}`);
    const icon = document.createElement("span");
    icon.className = "history-icon";
    icon.textContent = "◷";
    const title = document.createElement("span");
    title.className = "history-title";
    title.textContent = chat.title;
    openButton.append(icon, title);
    openButton.addEventListener("click", () => selectChat(chat.id));

    const deleteButton = document.createElement("button");
    deleteButton.className = "delete-chat";
    deleteButton.type = "button";
    deleteButton.setAttribute("aria-label", `Delete ${chat.title}`);
    deleteButton.textContent = "×";
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      chats = chats.filter((entry) => entry.id !== chat.id);
      if (currentChatId === chat.id) currentChatId = null;
      saveChats();
      render();
    });

    item.append(openButton, deleteButton);
    elements.conversationList.append(item);
  });
}

function appendMessage(role, text) {
  const message = document.createElement("article");
  message.className = `message ${role}`;
  const avatar = document.createElement("div");
  avatar.className = `avatar ${role === "bot" ? "bot-avatar" : "profile-avatar"}`;
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = role === "bot" ? "c" : "Y";
  const body = document.createElement("div");
  body.className = "message-body";
  const content = document.createElement("div");
  content.className = "message-text";
  content.textContent = text;
  body.append(content);
  message.append(avatar, body);
  elements.messages.append(message);
}

function showTyping() {
  const message = document.createElement("article");
  message.className = "message bot typing-message";
  message.innerHTML = '<div class="avatar bot-avatar" aria-hidden="true">c</div><div class="message-body"><div class="typing-indicator" aria-label="Thinking"><span></span><span></span><span></span></div></div>';
  elements.messages.append(message);
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function render() {
  const chat = getCurrentChat();
  const hasMessages = Boolean(chat?.messages.length);
  elements.welcome.classList.toggle("hidden", hasMessages);
  elements.messages.classList.toggle("visible", hasMessages);
  elements.messages.replaceChildren();

  if (chat) chat.messages.forEach((message) => appendMessage(message.role, message.text));
  renderHistory();
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function selectChat(id) {
  currentChatId = id;
  render();
  closeSidebar();
}

function newChat() {
  currentChatId = null;
  render();
  elements.input.focus();
  closeSidebar();
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => elements.toast.classList.remove("visible"), 2200);
}

function sendMessage(text) {
  const cleanText = text.trim();
  if (!cleanText) return;

  let chat = getCurrentChat();
  if (!chat) {
    chat = { id: makeId(), title: cleanText.slice(0, 36), messages: [], updatedAt: Date.now() };
    chats.push(chat);
    currentChatId = chat.id;
  }

  chat.messages.push({ role: "user", text: cleanText });
  chat.updatedAt = Date.now();
  saveChats();
  render();
  showTyping();
  elements.input.value = "";
  elements.send.disabled = true;
  resizeInput();

  const chatId = chat.id;
  setTimeout(() => {
    const target = chats.find((entry) => entry.id === chatId);
    if (!target) return;
    target.messages.push({ role: "bot", text: getReply(cleanText) });
    target.updatedAt = Date.now();
    saveChats();
    if (currentChatId === chatId) render();
    else renderHistory();
  }, 420);
}

function resizeInput() {
  elements.input.style.height = "auto";
  elements.input.style.height = `${Math.min(elements.input.scrollHeight, 150)}px`;
}

function openSidebar() {
  elements.sidebar.classList.add("open");
  elements.sidebarScrim.classList.add("visible");
}

function closeSidebar() {
  elements.sidebar.classList.remove("open");
  elements.sidebarScrim.classList.remove("visible");
}

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(elements.input.value);
});

elements.input.addEventListener("input", () => {
  elements.send.disabled = !elements.input.value.trim();
  resizeInput();
});

elements.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    elements.form.requestSubmit();
  }
});

document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => sendMessage(button.dataset.prompt));
});

document.querySelector("#new-chat").addEventListener("click", newChat);
document.querySelector("#open-sidebar").addEventListener("click", openSidebar);
document.querySelector("#close-sidebar").addEventListener("click", closeSidebar);
elements.sidebarScrim.addEventListener("click", closeSidebar);
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    newChat();
  }
});

render();
fetch("aiml.xml")
  .then((response) => {
    if (!response.ok) throw new Error("AIML rules could not be loaded.");
    return response.text();
  })
  .then((xmlText) => {
    categories = collectCategories(xmlText);
    elements.status.textContent = "Ready";
  })
  .catch((error) => {
    elements.status.textContent = "Rules unavailable";
    showToast(error.message);
  });