export type Mode = "dashboard" | "bookmarks";
export type AccessMode = "setup" | "open" | "password";

interface Session {
  mode: Mode;
  accessMode: AccessMode;
  authenticated: boolean;
}

export const session: Session = {
  mode: "dashboard",
  accessMode: "setup",
  authenticated: false,
};
