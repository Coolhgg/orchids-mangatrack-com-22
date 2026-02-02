export const UI_TEXT = {
  CHAPTERS: {
    ACTIONS: {
      READ: "Read",
      MARK_READ: "Mark as Read",
      MARK_UNREAD: "Mark as Unread",
      STATUS_READ: "Read",
      STATUS_UNREAD: "Unread",
      SHOW_SOURCES: "Show all sources",
      HIDE_SOURCES: "Hide sources",
      SELECT_SOURCE: "Select Source",
    },
    TOOLTIPS: {
      MULTI_SOURCE: (count: number) => `Available from ${count} sources`,
      READ_CHAPTER: "Open chapter in a new tab",
      MARK_READ: "Mark as read and update progress",
      MARK_UNREAD: "Mark as unread and revert progress",
    },
    EMPTY_STATES: {
      NO_CHAPTERS: "No chapters available for this series yet.",
      NO_UNREAD: "You're all caught up! No unread chapters.",
      FILTER_NO_RESULTS: "No chapters match your current filters.",
    },
    ACCESSIBILITY: {
      READ_CHAPTER: (num: number) => `Read Chapter ${num}`,
      MARK_CHAPTER_READ: (num: number) => `Mark Chapter ${num} as read`,
      MARK_CHAPTER_UNREAD: (num: number) => `Mark Chapter ${num} as unread`,
      OPEN_SOURCE: (source: string) => `Open on ${source}`,
      EXPAND_SOURCES: (num: number) => `Show ${num} sources for this chapter`,
    },
  },
  LIBRARY: {
    EMPTY_STATE: "Your library is empty. Start adding series to track your progress!",
    NO_UPDATES: "No new updates for your followed series.",
  },
  SEARCH: {
    EMPTY_STATE: "No results found. Try a different search term or check your spelling.",
  },
} as const;
