export type ToolKind = 'whiteboard' | 'writer';

export type SiteData = {
  projectName: string;
  schoolName: string;
  className: string;
  welcomeText: string;
};

export type Workspace = {
  id: string;
  type: ToolKind;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type RecentWorkspace = Pick<Workspace, 'id' | 'type' | 'title' | 'updatedAt'> & { editKey?: string };

export type AppRoute =
  | { page: 'home' }
  | { page: 'about' }
  | { page: 'tool'; type: ToolKind; id?: string; editKey?: string };
