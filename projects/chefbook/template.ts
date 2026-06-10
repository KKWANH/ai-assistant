/**
 * Chefbook starter — sample files injected when a workspace is created
 * with starter="chefbook".
 *
 * Provides:
 *   ingredients.csv — what's in the kitchen, with expiry dates and calories
 *   tools.csv       — what cooking equipment you own
 *   recipes.csv     — saved recipes with prep time and calories
 *   surface.tsx     — a kitchen dashboard reading those three files
 *
 * The dashboard surfaces the things you actually need to decide what to
 * cook tonight: KPIs, ingredients expiring soon, a sortable recipes list.
 * Later iterations can build on this for diet / meal-plan tracking.
 */

export const INGREDIENTS_CSV = `name,category,quantity,unit,expiry,kcal_per_100g
계란,단백질,8,개,2026-06-05,143
닭가슴살,단백질,300,g,2026-05-30,165
두부,단백질,1,모,2026-05-28,76
연어,단백질,200,g,2026-05-27,208
양파,채소,3,개,2026-06-10,40
당근,채소,2,개,2026-06-15,41
시금치,채소,200,g,2026-05-26,23
브로콜리,채소,1,송이,2026-05-29,34
토마토,채소,4,개,2026-06-01,18
대파,채소,1,단,2026-06-03,32
마늘,채소,1,통,2026-07-01,149
김치,발효,500,g,2026-08-01,15
요거트,유제품,400,g,2026-06-08,59
우유,유제품,1,L,2026-06-02,42
체다치즈,유제품,150,g,2026-07-15,403
버터,유제품,200,g,2026-08-10,717
쌀,곡류,5,kg,2026-12-31,365
귀리,곡류,1,kg,2026-10-20,389
파스타,곡류,500,g,2026-09-30,371
식빵,곡류,1,봉,2026-05-28,265
올리브유,오일,500,ml,2027-03-01,884
참기름,오일,250,ml,2027-01-15,884
간장,조미,500,ml,2027-06-01,53
된장,조미,500,g,2027-04-01,198
소금,조미,1,kg,2030-01-01,0
후추,조미,50,g,2028-01-01,251
바나나,과일,5,개,2026-05-27,89
사과,과일,3,개,2026-06-08,52
블루베리,과일,200,g,2026-05-30,57
레몬,과일,2,개,2026-06-10,29
`;

export const TOOLS_CSV = `name,category,notes
중식도,칼,주재료 손질
빵칼,칼,식빵·과일
도마,조리,대형 1·소형 1
프라이팬 28cm,팬,논스틱
프라이팬 22cm,팬,논스틱
웍 30cm,팬,스테인리스
편수냄비 18cm,냄비,수프·라면
양수냄비 24cm,냄비,파스타·찜
스테인리스 믹싱볼,그릇,3종 세트
계량스푼,측정,1Ts·1ts·1/2ts
계량컵,측정,250 ml 유리
저울,측정,주방용 1g 단위 디지털
오븐 토스터,가전,1200 W
인덕션,가전,3구
믹서,가전,스무디·소스용
에어프라이어,가전,5 L
국자,주방도구,
뒤집개,주방도구,논스틱용 실리콘
거품기,주방도구,
필러,주방도구,
강판,주방도구,치즈·생강·마늘
계란말이팬,팬,사각 18cm
`;

export const RECIPES_CSV = `name,tags,kcal,prep_minutes,ingredients
김치볶음밥,한식;간단;1인,520,15,쌀;김치;계란;대파;참기름;간장
연어 스테이크,서양;단백질,440,20,연어;올리브유;소금;후추;레몬
계란 토마토 볶음,중식;간단,310,10,계란;토마토;대파;소금;후추;올리브유
브로콜리 두부 샐러드,건강;다이어트,260,15,두부;브로콜리;올리브유;간장;참기름
오트밀 그릇,아침;간단,330,5,귀리;우유;바나나;블루베리;요거트
시금치 된장국,한식;국,90,15,시금치;된장;대파;마늘
크림 파스타,서양;든든,690,20,파스타;우유;체다치즈;마늘;버터;후추
닭가슴살 샐러드,건강;다이어트;단백질,380,20,닭가슴살;시금치;토마토;올리브유;레몬;소금
프렌치 토스트,아침;디저트,420,15,식빵;계란;우유;버터;바나나
김치찜,한식;든든,460,40,김치;돼지고기?;두부;대파;마늘
`;

export const SURFACE_TSX = `/**
 * Chefbook — custom Ariadne surface (kitchen / cooking tracker).
 *
 * Reads ingredients.csv, tools.csv, recipes.csv and renders KPIs, an
 * 'expiring soon' list, a category breakdown, and a sortable recipes
 * table with kcal and prep time.
 *
 * This file lives at .ariadne/surface.tsx. Edit it freely, then click
 * "Build" to recompile and see the result in the workspace's Custom
 * screen tab.
 */

import { useState, useEffect, useAriadne, BarChart, PieChart } from "@ariadne/surface";

// ── Types ──────────────────────────────────────────────────────────────────

interface Ingredient {
  name: string;
  category: string;
  quantity: number;
  unit: string;
  expiry: string;          // YYYY-MM-DD
  kcalPer100g: number;
}

interface Tool {
  name: string;
  category: string;
  notes: string;
}

interface Recipe {
  name: string;
  tags: string[];
  kcal: number;
  prepMinutes: number;
  ingredients: string[];
}

type SortKey = "name" | "kcal" | "prepMinutes";

// ── Helpers ────────────────────────────────────────────────────────────────

function num(s: string | undefined): number {
  const n = parseFloat(s || "0");
  return isFinite(n) ? n : 0;
}

function daysUntil(date: string): number | null {
  if (!date) return null;
  const target = Date.parse(date + "T00:00:00");
  if (isNaN(target)) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today.getTime()) / (1000 * 60 * 60 * 24));
}

function expiryTone(days: number | null): string {
  if (days === null) return "rgb(var(--muted-foreground))";
  if (days < 0) return "rgb(var(--destructive))";
  if (days <= 3) return "rgb(var(--warning))";
  if (days <= 7) return "rgb(var(--info))";
  return "rgb(var(--muted-foreground))";
}

const cardStyle = {
  border: "1px solid rgb(var(--border))",
  borderRadius: "10px",
  background: "rgb(var(--card))",
  padding: "14px 16px",
};

// ── Parsers ─────────────────────────────────────────────────────────────────

function parseIngredients(rows: Record<string, string>[]): Ingredient[] {
  return rows.map((r) => ({
    name: r["name"] || "",
    category: r["category"] || "기타",
    quantity: num(r["quantity"]),
    unit: r["unit"] || "",
    expiry: r["expiry"] || "",
    kcalPer100g: num(r["kcal_per_100g"]),
  }));
}

function parseTools(rows: Record<string, string>[]): Tool[] {
  return rows.map((r) => ({
    name: r["name"] || "",
    category: r["category"] || "",
    notes: r["notes"] || "",
  }));
}

function parseRecipes(rows: Record<string, string>[]): Recipe[] {
  return rows.map((r) => ({
    name: r["name"] || "",
    tags: (r["tags"] || "").split(";").map((s) => s.trim()).filter(Boolean),
    kcal: num(r["kcal"]),
    prepMinutes: num(r["prep_minutes"]),
    ingredients: (r["ingredients"] || "").split(";").map((s) => s.trim()).filter(Boolean),
  }));
}

// ── Small components ────────────────────────────────────────────────────────

function Centered(props: { text: string; tone?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "220px" }}>
      <p style={{ color: props.tone === "error" ? "rgb(var(--destructive))" : "rgb(var(--muted-foreground))" }}>
        {props.text}
      </p>
    </div>
  );
}

function Kpi(props: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ ...cardStyle, flex: "1 1 158px", minWidth: "158px" }}>
      <div style={{ fontSize: "11px", color: "rgb(var(--muted-foreground))", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>
        {props.label}
      </div>
      <div style={{ fontSize: "22px", fontWeight: 700, lineHeight: 1.1, color: props.color || "rgb(var(--card-foreground))" }}>
        {props.value}
      </div>
      {props.sub ? (
        <div style={{ fontSize: "12px", marginTop: "3px", color: "rgb(var(--muted-foreground))" }}>
          {props.sub}
        </div>
      ) : null}
    </div>
  );
}

function Tag(props: { label: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: "999px",
        fontSize: "11px",
        background: "rgb(var(--surface-3))",
        color: "rgb(var(--muted-foreground))",
        marginRight: "4px",
      }}
    >
      {props.label}
    </span>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────

export default function ChefbookDashboard() {
  const ariadne = useAriadne();
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    async function load() {
      try {
        const [ing, tls, rec] = await Promise.all([
          ariadne.readCsv("ingredients.csv"),
          ariadne.readCsv("tools.csv"),
          ariadne.readCsv("recipes.csv"),
        ]);
        setIngredients(parseIngredients(ing.rows));
        setTools(parseTools(tls.rows));
        setRecipes(parseRecipes(rec.rows));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [ariadne]);

  if (loading) return <Centered text="주방 정보를 불러오는 중…" />;
  if (error) return <Centered text={"오류: " + error} tone="error" />;

  // KPIs
  const totalIngredients = ingredients.length;
  const expiringSoon = ingredients.filter((i) => {
    const d = daysUntil(i.expiry);
    return d !== null && d >= 0 && d <= 7;
  });
  const expired = ingredients.filter((i) => {
    const d = daysUntil(i.expiry);
    return d !== null && d < 0;
  });

  // Category breakdown (ingredients)
  const byCategory = new Map<string, number>();
  for (const i of ingredients) {
    byCategory.set(i.category, (byCategory.get(i.category) || 0) + 1);
  }
  const categoryData = Array.from(byCategory.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value }));

  // Sort recipes
  const sortedRecipes = recipes.slice().sort((a, b) => {
    let cmp = 0;
    if (sortKey === "name") cmp = a.name.localeCompare(b.name);
    else if (sortKey === "kcal") cmp = a.kcal - b.kcal;
    else if (sortKey === "prepMinutes") cmp = a.prepMinutes - b.prepMinutes;
    return sortDir === "asc" ? cmp : -cmp;
  });

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  }

  // Ingredients expiring next
  const upcoming = ingredients
    .map((i) => ({ ...i, days: daysUntil(i.expiry) }))
    .filter((i) => i.days !== null)
    .sort((a, b) => (a.days || 0) - (b.days || 0))
    .slice(0, 8);

  return (
    <div style={{ padding: "20px 24px", color: "rgb(var(--foreground))", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <header style={{ marginBottom: "18px" }}>
        <h1 style={{ fontSize: "20px", fontWeight: 700, margin: 0 }}>Chefbook</h1>
        <p style={{ fontSize: "13px", color: "rgb(var(--muted-foreground))", margin: "4px 0 0" }}>
          냉장고와 도구를 한눈에 — 오늘 뭐 만들지 결정에 필요한 정보들
        </p>
      </header>

      {/* KPIs */}
      <section style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "20px" }}>
        <Kpi label="재료" value={totalIngredients.toString()} sub="등록된 항목" />
        <Kpi
          label="만료 임박"
          value={expiringSoon.length.toString()}
          sub="7일 이내"
          color={expiringSoon.length > 0 ? "rgb(var(--warning))" : undefined}
        />
        <Kpi
          label="이미 만료"
          value={expired.length.toString()}
          sub={expired.length > 0 ? "확인 필요" : "없음"}
          color={expired.length > 0 ? "rgb(var(--destructive))" : undefined}
        />
        <Kpi label="레시피" value={recipes.length.toString()} sub="저장된" />
        <Kpi label="도구" value={tools.length.toString()} sub="등록된" />
      </section>

      {/* Two-column: expiring + categories */}
      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "20px" }}>
        <div style={cardStyle}>
          <div style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.05em", color: "rgb(var(--muted-foreground))", marginBottom: "10px" }}>
            만료 임박
          </div>
          {upcoming.length === 0 ? (
            <p style={{ color: "rgb(var(--muted-foreground))", fontSize: "13px" }}>임박한 항목이 없습니다.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {upcoming.map((i) => (
                <li key={i.name} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px dashed rgb(var(--border))" }}>
                  <span style={{ fontSize: "13px" }}>{i.name}</span>
                  <span style={{ fontSize: "12px", color: expiryTone(i.days), fontWeight: 600 }}>
                    {i.days === null ? "—" : i.days < 0 ? \`만료 \${Math.abs(i.days)}일 전\` : \`\${i.days}일 남음\`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div style={cardStyle}>
          <div style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.05em", color: "rgb(var(--muted-foreground))", marginBottom: "10px" }}>
            카테고리별 재료
          </div>
          <PieChart data={categoryData} size={180} />
        </div>
      </section>

      {/* Recipes table */}
      <section style={cardStyle}>
        <div style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.05em", color: "rgb(var(--muted-foreground))", marginBottom: "10px" }}>
          저장된 레시피
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr>
                <th onClick={() => toggleSort("name")} style={{ textAlign: "left", padding: "8px 6px", cursor: "pointer", borderBottom: "1px solid rgb(var(--border))" }}>
                  이름 {sortKey === "name" ? (sortDir === "asc" ? "▲" : "▼") : ""}
                </th>
                <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid rgb(var(--border))" }}>태그</th>
                <th onClick={() => toggleSort("kcal")} style={{ textAlign: "right", padding: "8px 6px", cursor: "pointer", borderBottom: "1px solid rgb(var(--border))" }}>
                  kcal {sortKey === "kcal" ? (sortDir === "asc" ? "▲" : "▼") : ""}
                </th>
                <th onClick={() => toggleSort("prepMinutes")} style={{ textAlign: "right", padding: "8px 6px", cursor: "pointer", borderBottom: "1px solid rgb(var(--border))" }}>
                  분 {sortKey === "prepMinutes" ? (sortDir === "asc" ? "▲" : "▼") : ""}
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedRecipes.map((r) => (
                <tr key={r.name}>
                  <td style={{ padding: "8px 6px", borderBottom: "1px dashed rgb(var(--border))" }}>{r.name}</td>
                  <td style={{ padding: "8px 6px", borderBottom: "1px dashed rgb(var(--border))" }}>
                    {r.tags.map((t) => <Tag key={t} label={t} />)}
                  </td>
                  <td style={{ padding: "8px 6px", borderBottom: "1px dashed rgb(var(--border))", textAlign: "right" }}>{r.kcal}</td>
                  <td style={{ padding: "8px 6px", borderBottom: "1px dashed rgb(var(--border))", textAlign: "right" }}>{r.prepMinutes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
`;
