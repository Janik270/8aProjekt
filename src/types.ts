export type ToolKind = 'whiteboard' | 'writer';
export type TrafficColor = 'red' | 'yellow' | 'green';

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

export type AccountUser = { id: string; username: string };
export type AccountProject = Pick<Workspace, 'id' | 'type' | 'title' | 'createdAt' | 'updatedAt'> & {
  role: 'owner' | 'edit' | 'view';
  editKey?: string;
  addedAt: string;
};
export type AccountData = { user: AccountUser; projects: AccountProject[] };

export type AppRoute =
  | { page: 'home' }
  | { page: 'about' }
  | { page: 'timer' }
  | { page: 'tool'; type: ToolKind; id?: string; editKey?: string }
  | { page: 'traffic'; id?: string; teacherKey?: string };
