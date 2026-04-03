export interface Folder {
  id: string;
  name: string;
  description: string;
  children: TreeNode[];
}

export interface Connection {
  id: string;
  name: string;
  description: string;
  rustdesk_id: string;
  password: string;
  created_at: string;
  updated_at: string;
}

export type TreeNode =
  | {
      type: "Folder";
      id: string;
      name: string;
      description: string;
      children: TreeNode[];
    }
  | {
      type: "Connection";
      id: string;
      name: string;
      description: string;
      rustdesk_id: string;
      password: string;
      created_at: string;
      updated_at: string;
    };

export type SelectedItem =
  | { kind: "folder"; data: Folder }
  | { kind: "connection"; data: Connection }
  | null;

export interface Subscription {
  id: string;
  name: string;
  url: string;
  master_key: string;
  folder_id: string;
  last_id: number;
  last_synced: string | null;
}
