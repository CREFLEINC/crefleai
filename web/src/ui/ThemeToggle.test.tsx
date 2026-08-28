import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import ThemeToggle from "./ThemeToggle";

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = "";
});

it("선택한 테마를 문서와 localStorage에 반영한다", async () => {
  localStorage.setItem("crefleai_theme", "dark");
  const user = userEvent.setup();

  render(<ThemeToggle compact />);
  await user.click(screen.getByRole("button", { name: "라이트 모드로 전환" }));

  expect(document.documentElement.dataset.theme).toBe("light");
  expect(document.documentElement.style.colorScheme).toBe("light");
  expect(localStorage.getItem("crefleai_theme")).toBe("light");
  expect(
    screen.getByRole("button", { name: "다크 모드로 전환" }),
  ).toBeInTheDocument();
});
