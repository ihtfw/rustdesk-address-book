import { invoke } from "@tauri-apps/api/core";
import type { Folder, Connection, Subscription, AccessTokenInfo, CreatedToken, SyncResult } from "./types";

// Auth
export const addressBookExists = () => invoke<boolean>("address_book_exists");
export const getStoragePath = () => invoke<string>("get_storage_path");
export const setStoragePath = (path: string) =>
  invoke<void>("set_storage_path", { path });
export const checkFileExists = (path: string) =>
  invoke<boolean>("check_file_exists", { path });
export const getRecentPaths = () => invoke<string[]>("get_recent_paths");
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
export const undoDelete = () => invoke<void>("undo_delete");
export const moveNode = (
  nodeId: string,
  newParentId: string,
  position: number,
) => invoke<void>("move_node", { nodeId, newParentId, position });

// Connection
export const connectToHost = (connectionId: string) =>
  invoke<string>("connect", { connectionId });

// RustDesk path
export const getRustdeskPath = () => invoke<string>("get_rustdesk_path");
export const setRustdeskPath = (path: string) =>
  invoke<void>("set_rustdesk_path", { path });
export const detectRustdesk = () => invoke<string>("detect_rustdesk");

// Auto-update
export const getAutoUpdate = () => invoke<boolean>("get_auto_update");
export const setAutoUpdate = (enabled: boolean) =>
  invoke<void>("set_auto_update", { enabled });

// Language
export const getLanguage = () => invoke<string>("get_language");
export const setLanguage = (lang: string) =>
  invoke<void>("set_language", { lang });

// Sync interval
export const getSyncInterval = () => invoke<number>("get_sync_interval");
export const setSyncInterval = (minutes: number) =>
  invoke<void>("set_sync_interval", { minutes });

// Export / Import
export const exportNodes = (nodeIds: string[], password: string, filePath: string) =>
  invoke<void>("export_nodes", { nodeIds, password, filePath });
export const importNodes = (filePath: string, password: string) =>
  invoke<Folder>("import_nodes", { filePath, password });
export const tryImport = (filePath: string) =>
  invoke<boolean>("try_import", { filePath });

// Subscriptions
export const getSubscriptions = () =>
  invoke<Subscription[]>("get_subscriptions");
export const addSubscription = (name: string, url: string, masterKey: string, accessToken?: string) =>
  invoke<Subscription>("add_subscription", { name, url, masterKey, accessToken: accessToken || null });
export const updateSubscription = (id: string, name: string, url: string, masterKey: string) =>
  invoke<Subscription>("update_subscription", { id, name, url, masterKey });
export const removeSubscription = (id: string) =>
  invoke<void>("remove_subscription", { id });
export const syncPull = (subscriptionId: string) =>
  invoke<Folder>("sync_pull", { subscriptionId });
export const syncPush = (subscriptionId: string) =>
  invoke<void>("sync_push", { subscriptionId });
export const syncSubscription = (subscriptionId: string) =>
  invoke<SyncResult>("sync_subscription", { subscriptionId });

// Access tokens
export const listAccessTokens = (subscriptionId: string) =>
  invoke<AccessTokenInfo[]>("list_access_tokens", { subscriptionId });
export const createAccessToken = (subscriptionId: string, label: string, permissions: string) =>
  invoke<CreatedToken>("create_access_token", { subscriptionId, label, permissions });
export const revokeAccessToken = (subscriptionId: string, tokenId: number) =>
  invoke<void>("revoke_access_token", { subscriptionId, tokenId });
export const checkSubscriptionPermissions = (subscriptionId: string) =>
  invoke<string>("check_subscription_permissions", { subscriptionId });
