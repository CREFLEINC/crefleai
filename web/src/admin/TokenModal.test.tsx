import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it } from "vitest";
import type { CreatedToken } from "../types";
import TokenModal from "./TokenModal";

const CREATED_TOKEN: CreatedToken = {
  token: "aaa.bbb.ccc",
  jti: "j1",
  user_name: "홍길동",
  purpose: "테스트",
  created_at: "2026-08-04T00:00:00+00:00",
};

function TokenModalHarness() {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)}>
        토큰 모달 열기
      </button>
      <button type="button">배경 작업</button>
      {isOpen && (
        <TokenModal
          created={CREATED_TOKEN}
          onClose={() => setIsOpen(false)}
        />
      )}
    </>
  );
}

it("포커스를 모달 안에 가두고 닫은 뒤 호출 요소로 복원한다", async () => {
  const user = userEvent.setup();
  render(<TokenModalHarness />);
  const trigger = screen.getByRole("button", { name: "토큰 모달 열기" });

  await user.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "발급된 토큰" });
  const buttons = within(dialog).getAllByRole("button");
  expect(buttons[0]).toHaveFocus();

  await user.tab({ shift: true });
  expect(buttons.at(-1)).toHaveFocus();
  await user.tab();
  expect(buttons[0]).toHaveFocus();

  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(trigger).toHaveFocus();
});
