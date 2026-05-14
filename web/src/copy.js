export const COPY_EN = {
  locale: "en",
  productName: "AI Workbench Studio",
  shortName: "AIWS",
  tagline: "Local-first AI cockpit for projects, files, and agent runs.",
  brandCompact: "Workbench",
  nav: {
    home: "Home",
    newChat: "New Chat",
    newProject: "New Project",
    actions: "Actions",
    projects: "Projects",
    chats: "Chats",
    workspace: "Workspace",
    oneOffChats: "One-off chats",
    searchPlaceholder: "Search chat titles",
    noSearchResults: "No results.",
  },
  topbar: {
    localFirst: "Local-first",
    contextOpen: "Close Context & Files",
    contextClosed: "Open Context & Files",
    modeLabel: "Mode",
  },
  home: {
    title: "Local AI Workbench",
    subtitle: "Start with a file, prompt, action, or project manifest.",
    quickActions: "Quick Actions",
    quickActionsHint: "Run a projectless action, then save the useful workflow into a project.",
    recentRuns: "Recent Runs",
    artifacts: "Artifacts",
    configure: "Configure",
    runBeforeProject: "Run before creating a project",
    runHistory: "Run history",
    starterEmpty: "Starter Actions leave plans, logs, and artifacts here.",
    artifactEmpty: "Markdown, CSV, JSON, and report outputs appear as clickable objects.",
  },
  inspector: {
    title: "Context & Files",
    powerTitle: "Right Inspector",
    emptyPurpose: "Start a chat to see the files, context, goals, runs, and diagnostics used by this workspace.",
    currentContext: "Current Context",
    tabs: {
      context: "Context",
      files: "Files",
      memory: "Memory",
      runs: "Runs",
      artifacts: "Artifacts",
      diagnostics: "Diagnostics",
    },
    diagnosticsWarning: "Public tunnel is active. Do not expose diagnostics without authentication.",
  },
  settings: {
    title: "Workspace Settings",
    close: "Close",
    savedMessages: "Saved messages",
    aiRequests: "AI requests",
    monthlyApiCost: "API cost this month",
    profile: "Profile",
    avatar: "Profile photo",
    name: "Name",
    age: "Age",
    role: "Job / role",
    language: "Language",
    personalContext: "Personal Context",
    situation: "Situation / chat context",
    addMemory: "Add to memory",
    memoryPlaceholder: "Write anything the workbench should remember later.",
    interface: "Interface",
    uiMode: "UI mode",
    easyMode: "Easy Mode - focused workspace",
    powerMode: "Power Mode - diagnostics and execution details",
    modeHelp: "Easy keeps model and file controls visible while hiding operator logs. Power shows execution paths, cost, prompts, and runtime details.",
    saveProfile: "Save profile",
  },
  modelPicker: {
    title: "Select AI Model",
    selected: "selected",
    groups: {
      recommended: "Recommended",
      local: "Local",
      fast: "Fast",
      long: "Long context",
      reasoning: "Reasoning",
      coding: "Coding",
      all: "All",
    },
  },
  search: {
    off: "Search off",
    auto: "Local context first",
    always: "Web search (planned)",
  },
  chat: {
    emptyTitle: "What are we working on?",
    emptyBody: "This workspace is ready. Choose a model, attach files, or open Context & Files.",
    assistantThinking: "Workbench is thinking",
    preparing: "Workbench is preparing your answer",
    attachFile: "Attach file",
    placeholder: "Ask anything",
    quickPrompts: ["Describe an image", "Summarize a document", "Organize tasks", "Help me write"],
  },
  project: {
    memory: "Project Memory",
    recipeStatus: "Recipe Status",
    artifacts: "Artifacts",
  },
  starterActions: {
    document_summary: {
      label: "Summarize document",
      category: "Document",
      description: "Read a PDF, DOCX, TXT, or MD file and produce a structured summary.",
      prompt: "Summarize the attached document structurally. Separate the core claims, important evidence, and follow-up questions.",
    },
    image_explain: {
      label: "Describe image",
      category: "Image",
      description: "Attach an image and ask the workspace to describe or compare what it sees.",
      prompt: "Describe the attached image. Split the visible elements, important context, and things I should verify.",
    },
    csv_analysis: {
      label: "Analyze CSV",
      category: "Data",
      description: "Inspect CSV columns, key numbers, and possible outliers.",
      prompt: "Read the attached CSV and summarize the column structure, key figures, possible outliers, and next analysis steps.",
    },
    codex_task_prompt: {
      label: "Create Codex task prompt",
      category: "Code",
      description: "Turn a goal and constraints into an execution-ready Codex prompt.",
      prompt: "Turn the goal below into a Codex task prompt. Include repo context, constraints, test commands, and acceptance criteria.",
    },
    investment_rebalancer: {
      label: "Investment rebalancer",
      category: "Investment",
      description: "Start a rebalancing workspace from CSV/YAML inputs.",
      prompt: "Use the portfolio CSV and target allocation YAML to summarize current weights, target gaps, and rebalance candidates.",
    },
    folder_index: {
      label: "Read folder structure",
      category: "Files",
      description: "Plan a file index for turning a local folder into an AIWS project.",
      prompt: "Propose file grouping and a workspace plan for turning this folder structure into an AIWS project.",
    },
  },
};

export const COPY_KO = {
  locale: "ko",
  productName: "AI Workbench Studio",
  shortName: "AIWS",
  tagline: "프로젝트, 파일, 에이전트 실행을 연결하는 로컬 우선 AI 작업실.",
  brandCompact: "Workbench",
  nav: {
    home: "홈",
    newChat: "새 대화",
    newProject: "새 프로젝트",
    actions: "액션",
    projects: "프로젝트",
    chats: "대화",
    workspace: "작업실",
    oneOffChats: "일회성 대화",
    searchPlaceholder: "대화 제목 검색",
    noSearchResults: "검색 결과가 없습니다.",
  },
  topbar: {
    localFirst: "로컬 우선",
    contextOpen: "Context & Files 닫기",
    contextClosed: "Context & Files 열기",
    modeLabel: "모드",
  },
  home: {
    title: "로컬 AI 작업실",
    subtitle: "파일, 프롬프트, 액션, 프로젝트 manifest에서 바로 시작하세요.",
    quickActions: "빠른 액션",
    quickActionsHint: "프로젝트 없이 실행한 뒤, 쓸만한 흐름은 프로젝트로 저장합니다.",
    recentRuns: "최근 실행",
    artifacts: "산출물",
    configure: "설정",
    runBeforeProject: "프로젝트 없이 바로 시작",
    runHistory: "실행 기록",
    starterEmpty: "Starter Action을 실행하면 Plan, Log, Artifact가 여기에 남습니다.",
    artifactEmpty: "Markdown, CSV, JSON 같은 결과물이 클릭 가능한 객체로 표시됩니다.",
  },
  inspector: {
    title: "Context & Files",
    powerTitle: "Right Inspector",
    emptyPurpose: "대화를 시작하면 이 작업실이 참고하는 파일, 컨텍스트, 목표, 실행 기록, 진단 정보가 여기에 정리됩니다.",
    currentContext: "현재 컨텍스트",
    tabs: {
      context: "Context",
      files: "Files",
      memory: "Memory",
      runs: "Runs",
      artifacts: "Artifacts",
      diagnostics: "Diagnostics",
    },
    diagnosticsWarning: "공개 터널이 활성화되어 있습니다. 인증 없이 diagnostics를 노출하지 마세요.",
  },
  settings: {
    title: "작업실 설정",
    close: "닫기",
    savedMessages: "저장 메시지",
    aiRequests: "AI 요청",
    monthlyApiCost: "이번 달 API 비용",
    profile: "프로필",
    avatar: "프로필 사진",
    name: "이름",
    age: "나이",
    role: "직업 / 역할",
    language: "언어",
    personalContext: "개인 컨텍스트",
    situation: "상황 / 대화 컨텍스트",
    addMemory: "기억에 추가",
    memoryPlaceholder: "Workbench가 앞으로 기억하면 좋은 내용을 적어주세요.",
    interface: "인터페이스",
    uiMode: "사용 모드",
    easyMode: "Easy Mode - 쉬운 화면",
    powerMode: "Power Mode - 운영자 화면",
    modeHelp: "Easy는 모델 선택과 파일 첨부는 그대로 두고 운영자 로그를 숨깁니다. Power는 실행 경로, 비용, prompt, runtime을 확인하는 화면입니다.",
    saveProfile: "프로필 저장",
  },
  modelPicker: {
    title: "AI 모델 선택",
    selected: "사용 중",
    groups: {
      recommended: "추천",
      local: "로컬",
      fast: "빠른 작업",
      long: "긴 문서",
      reasoning: "추론",
      coding: "코딩",
      all: "전체",
    },
  },
  search: {
    off: "검색 끔",
    auto: "로컬 컨텍스트 우선",
    always: "웹 검색 (준비 중)",
  },
  chat: {
    emptyTitle: "무엇을 도와드릴까요?",
    emptyBody: "이 작업실은 준비되었습니다. 모델을 고르거나, 파일을 첨부하거나, Context & Files를 열어보세요.",
    assistantThinking: "Workbench가 생각 중",
    preparing: "Workbench가 답변을 준비 중",
    attachFile: "파일 추가",
    placeholder: "무엇이든 물어보세요",
    quickPrompts: ["이미지 설명하기", "문서 요약하기", "할 일 정리하기", "글쓰기 도와줘"],
  },
};

function mergeCopy(base, override) {
  const output = { ...base };
  Object.entries(override || {}).forEach(([key, value]) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      output[key] = mergeCopy(base[key] || {}, value);
    } else {
      output[key] = value;
    }
  });
  return output;
}

export function copyForLocale(locale = "en") {
  return String(locale || "").toLowerCase().startsWith("ko")
    ? mergeCopy(COPY_EN, COPY_KO)
    : COPY_EN;
}

export function copyForAccount(account) {
  return copyForLocale(account?.profile?.language || "en");
}

export const COPY = COPY_EN;
