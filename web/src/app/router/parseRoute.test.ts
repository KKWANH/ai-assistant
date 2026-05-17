import { describe, expect, it } from "vitest";
import { parseRoute } from "./parseRoute";

describe("parseRoute", () => {
  it("keeps query strings out of project slugs", () => {
    expect(parseRoute("/project/investment-advisor?tab=apps")).toMatchObject({
      projectPath: "investment-advisor",
      sessionSlug: "",
    });
  });

  it("parses workflow app routes without hash or query fragments", () => {
    expect(parseRoute("/project/investment-advisor/app/investment_rebalancer?tab=apps#viewer")).toMatchObject({
      view: "workflow-app",
      projectPath: "investment-advisor",
      appId: "investment_rebalancer",
    });
  });
});
