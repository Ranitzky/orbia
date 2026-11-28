export const readPreference = (key: string, fallback: string) => {
  try {
    return localStorage.getItem(`orbia.${key}`) || fallback;
  } catch {
    return fallback;
  }
};
export const preference = (key: string, value: string) => {
  try {
    localStorage.setItem(`orbia.${key}`, value);
  } catch {
    /* Preferences are optional in private browsing. */
  }
};
