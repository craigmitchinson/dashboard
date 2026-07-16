import { createContext, useContext } from "react";

// Lets any visual trigger report navigation (e.g. drill-through to a detail page).
export const NavContext = createContext<(pageId: string) => void>(() => {});
export const useNav = () => useContext(NavContext);
