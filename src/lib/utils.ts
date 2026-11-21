// 样式类名合并工具：结合 clsx 与 tailwind-merge 去重并解决 Tailwind 类冲突
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
