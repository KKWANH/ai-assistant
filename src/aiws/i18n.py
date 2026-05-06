"""Tiny UI translation table."""

from __future__ import annotations

TEXT = {
    "ko": {
        "home": "홈",
        "projects": "프로젝트",
        "create_project": "프로젝트 만들기",
        "profile": "프로필",
        "login": "로그인",
        "username": "사용자 이름",
        "password": "비밀번호",
        "language": "언어",
        "name": "이름",
        "age": "나이",
        "job": "직업",
        "situation": "상황",
        "memory": "저장 메모리",
        "avatar": "프로필 사진",
        "save": "저장",
        "ask_ollama": "Ollama에게 묻기",
        "recent_messages": "최근 메시지",
        "active_skills": "활성 스킬",
    },
    "en": {
        "home": "Home",
        "projects": "Projects",
        "create_project": "Create Project",
        "profile": "Profile",
        "login": "Login",
        "username": "Username",
        "password": "Password",
        "language": "Language",
        "name": "Name",
        "age": "Age",
        "job": "Job",
        "situation": "Situation",
        "memory": "Saved Memory",
        "avatar": "Profile Photo",
        "save": "Save",
        "ask_ollama": "Ask Ollama",
        "recent_messages": "Recent Messages",
        "active_skills": "Active Skills",
    },
}


def t(language: str, key: str) -> str:
    return TEXT.get(language, TEXT["ko"]).get(key, TEXT["ko"].get(key, key))
