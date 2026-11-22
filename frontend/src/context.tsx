import { createContext, useContext } from "react";
export type AppContextType = {
  user: any;
  home: any;
  reload: () => Promise<void>;
  notify: (text: string) => void;
  openAdd: (draft?: any) => void;
  setUser: (user: any) => void;
  online: boolean;
  pending: any[];
  sync: () => Promise<void>;
};
export const AppContext = createContext<AppContextType>(null!);
export const useApp = () => useContext(AppContext);
