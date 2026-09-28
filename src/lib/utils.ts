import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Adds a chat message unless it is already in the list. The sender gets their
 * message both from the insert response and from the realtime channel.
 */
export function appendMessage<T extends { id: string }>(list: T[], message: T): T[] {
  return list.some((m) => m.id === message.id) ? list : [...list, message];
}

/**
 * `yyyy-MM-dd` in the user's local time zone. `toISOString()` gives the UTC
 * date instead, which in Orenburg (UTC+5) is still "yesterday" until 5 am.
 */
export function toLocalDateString(date: Date | string = new Date()): string {
  return format(new Date(date), "yyyy-MM-dd");
}
