/**
 * Built-in tutorial workspace.
 *
 * A non-deletable example workspace seeded on first boot so the guided tour
 * and "try a template run" walkthroughs always have a real workspace — with
 * real files — to point at. Its id is fixed (TUTORIAL_WORKSPACE_ID); the
 * access guard and the delete route special-case it.
 */

import fs from "node:fs";
import path from "node:path";
import { TUTORIAL_WORKSPACE_ID, DEFAULT_INCLUDE, DEFAULT_EXCLUDE } from "@ariadne/shared";
import type { Workspace } from "@ariadne/shared";
import { dbGetWorkspace, dbInsertWorkspace } from "./db/repo.js";
import { PATHS } from "./config.js";
import { ensureAriadneFolder } from "./ariadneFolder.js";
import logger from "./logger.js";

/** Sample files placed in the workspace so template runs have real material. */
export const SAMPLE_FILES: Record<string, string> = {
  "welcome.md":
    "# 튜토리얼 워크스페이스\n\n" +
    "여기는 Ariadne에 기본으로 들어 있는 예시 워크스페이스입니다. 항상 이 자리에\n" +
    "있고 삭제할 수 없으므로, 마음 놓고 이것저것 시험해 볼 수 있는 공간입니다.\n\n" +
    "이 워크스페이스로 기본 흐름을 익혀 보세요:\n\n" +
    "- **만들기 및 실행** 탭을 열고, 이 폴더의 예시 메모를 대상으로 템플릿을\n" +
    "  실행해 보세요(예: 리서치 브리프).\n" +
    "- Ariadne가 폴더를 살펴보고, 어떤 파일을 읽을지 제안하고, 근거가 연결된\n" +
    "  브리프(주장-출처 연결 포함)를 만들어 내는 과정을 지켜보세요.\n" +
    "- 또는 이 워크스페이스를 붙인 채로 채팅을 열어 파일 내용을 물어보세요.\n\n" +
    "나머지 두 파일은 원격 근무에 대한 짧은 예시 메모로, 템플릿 실행이 요약하기에\n" +
    "충분한 분량입니다.\n",
  "remote-work-benefits.md":
    "# 원격 근무 — 보고된 장점\n\n" +
    "분산 팀을 대상으로 한 여러 설문에서는 몇 가지 장점이 일관되게 보고됩니다.\n\n" +
    "**시간과 비용.** 출퇴근이 사라지면 매주 몇 시간이 직원에게 되돌아오고, 매일\n" +
    "드는 교통비는 물론 식비·근무 복장 같은 사무실 관련 지출도 줄어듭니다.\n\n" +
    "**집중.** 상당수의 원격 근무자는, 즉흥적인 방해가 잦은 개방형 사무실보다\n" +
    "집에서 더 깊고 끊김 없는 작업을 해낸다고 답합니다.\n\n" +
    "**유연성과 유지율.** 일정과 장소를 스스로 정할 수 있다는 점은 가장 가치 있게\n" +
    "꼽히는 복지 중 하나이며, 이를 제공하는 회사는 대체로 더 높은 유지율과 지역에\n" +
    "구애받지 않는 넓은 채용 풀을 보고합니다.\n\n" +
    "**연속성.** 분산 팀은 날씨·교통·건강 같은 지역적 변수에 더 강했습니다. 업무가\n" +
    "하나의 건물에 묶여 있지 않기 때문입니다.\n",
  "remote-work-challenges.md":
    "# 원격 근무 — 보고된 어려움\n\n" +
    "같은 설문에서는 꾸준히 나타나는 어려움도 함께 드러납니다.\n\n" +
    "**고립감.** 외로움과 줄어든 사회적 연결은 가장 자주 언급되는 단점입니다.\n" +
    "복도에서 오가는 가벼운 대화는 온라인으로 옮기기 어렵습니다.\n\n" +
    "**경계.** 사무실이라는 물리적 분리가 없으면 업무 시간과 개인 시간이\n" +
    "흐려집니다. 일부 원격 근무자는 근무 시간이 길어지고 일에서 손을 떼기\n" +
    "어렵다고 말합니다.\n\n" +
    "**소통.** 비동기적인, 글 중심의 소통은 정확하지만 더 느리며, 새 팀원은\n" +
    "사무실이 암묵적으로 전달하던 맥락을 흡수하기 어려울 수 있습니다.\n\n" +
    "**온보딩.** 경력 초기 직원은 관찰로 배우는 경우가 많은데, 원격 환경에서는\n" +
    "그런 우연한 학습이 어려워지고 의도적으로 작성한 문서의 비중이 커집니다.\n\n" +
    "대부분의 조직은, 명확한 문서 규범과 주기적인 대면 시간을 결합한 의도적인\n" +
    "하이브리드 방식이 장점은 살리고 이런 비용은 줄인다고 결론짓습니다.\n",
};

/** Seed the tutorial workspace once, if it does not already exist. */
export function ensureTutorialWorkspace(): void {
  try {
    if (dbGetWorkspace(TUTORIAL_WORKSPACE_ID)) return;

    const rootPath = path.join(PATHS.home, "tutorial-workspace");
    fs.mkdirSync(rootPath, { recursive: true });
    for (const [name, content] of Object.entries(SAMPLE_FILES)) {
      const file = path.join(rootPath, name);
      if (!fs.existsSync(file)) fs.writeFileSync(file, content, "utf-8");
    }
    ensureAriadneFolder(rootPath);

    const workspace: Workspace = {
      id: TUTORIAL_WORKSPACE_ID,
      name: "튜토리얼 워크스페이스",
      rootPath,
      include: DEFAULT_INCLUDE,
      exclude: DEFAULT_EXCLUDE,
      createdAt: new Date().toISOString(),
      lastScanAt: null,
      fileCount: 0,
      createdBy: null,
      createdByName: null,
      visibility: "public",
      category: null,
      homeView: null,
      defaultProvider: null,
      defaultModel: null,
      defaultSkillId: null,
    };
    dbInsertWorkspace(workspace);
    logger.info({ rootPath }, "Seeded the built-in tutorial workspace");
  } catch (err) {
    logger.warn({ err }, "Failed to seed the tutorial workspace");
  }
}
