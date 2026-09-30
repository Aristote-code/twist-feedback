import type { ComponentType } from "react";
import { BookIcon, BugIcon, CursorIcon, IdeaIcon, MessageIcon, type IconProps } from "@/components/icons";
import type { CategoryIcon } from "./config";

export const CATEGORY_ICONS: Record<CategoryIcon, ComponentType<IconProps>> = {
  bug: BugIcon,
  idea: IdeaIcon,
  content: BookIcon,
  usability: CursorIcon,
  other: MessageIcon,
};
