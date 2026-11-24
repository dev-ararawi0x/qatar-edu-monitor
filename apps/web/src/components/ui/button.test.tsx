import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button.js";
import { Badge } from "./badge.js";

describe("Button", () => {
  it("renders children and handles clicks", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>احفظ</Button>);
    fireEvent.click(screen.getByRole("button", { name: "احفظ" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("respects disabled state", () => {
    render(<Button disabled>معطل</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("applies variant classes", () => {
    render(<Button variant="destructive">حذف</Button>);
    expect(screen.getByRole("button").className).toContain("bg-destructive");
  });
});

describe("Badge", () => {
  it("renders status text", () => {
    render(<Badge>جاهز للمراجعة</Badge>);
    expect(screen.getByText("جاهز للمراجعة")).toBeInTheDocument();
  });
});
