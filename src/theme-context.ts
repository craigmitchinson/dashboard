import { createContext, useContext } from "react";
import { lightTheme } from "./theme";
import type { ThemeTokens } from "./theme";

// The active theme variant (light or dark) flows down through context so every
// part of the slide switches in step from a single source of truth.
const ThemeContext = createContext<ThemeTokens>(lightTheme);

export const ThemeProvider = ThemeContext.Provider;
export const useTheme = (): ThemeTokens => useContext(ThemeContext);
