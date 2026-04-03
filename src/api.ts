import { invoke } from "@tauri-apps/api/core";
import type { Folder, Connection } from "./types";

// Auth
export const addressBookExists = () => invoke<boolean>("address_book_exists");
export const createAddressBook = (password: string) =>
  invoke<Folder>("create_address_book", { password });
export const unlockAddressBook = (password: string) =>
  invoke<Folder>("unlock_address_book", { password });
export const lockAddressBook = () => invoke<void>("lock_address_book");
export const changePassword = (oldPassword: string, newPassword: string) =>
  invoke<void>("change_password", { oldPassword, newPassword });

// Tree CRUD
export const getTree = () => invoke<Folder>("get_tree");
export const addFolder = (
  parentId: string,
  name: string,
  description: string,
) => invoke<Folder>("add_folder", { parentId, name, description });
export const addConnection = (
  parentId: string,
  name: string,
  description: string,
  rustdeskId: string,
  password: string,
) =>
  invoke<Connection>("add_connection", {
    parentId,
    name,
    description,
    rustdeskId,
    password,
  });
export const updateFolder = (id: string, name: string, description: string) =>
  invoke<Folder>("update_folder", { id, name, description });
export const updateConnection = (
  id: string,
  name: string,
  description: string,
  rustdeskId: string,
  password: string,
) =>
  invoke<Connection>("update_connection", {
    id,
    name,
    description,
    rustdeskId,
    password,
  });
export const deleteNode = (id: string) => invoke<void>("delete_node", { id });
export const moveNode = (
  nodeId: string,
  newParentId: string,
  position: number,
) => invoke<void>("move_node", { nodeId, newParentId, position });

// Connection
export const connectToHost = (connectionId: string) =>
  invoke<void>("connect", { connectionId });

// RustDesk path
export const getRustdeskPath = () => invoke<string>("get_rustdesk_path");
export const setRustdeskPath = (path: string) =>
  invoke<void>("set_rustdesk_path", { path });
export const detectRustdesk = () => invoke<string>("detect_rustdesk");
