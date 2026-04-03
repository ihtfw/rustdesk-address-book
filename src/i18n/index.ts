import { createContext, useContext } from "react";

export type Locale = "en" | "ru";

export interface Translations {
  // App
  loading: string;
  updateAvailable: (version: string) => string;

  // Lock screen
  unlockTitle: string;
  createTitle: string;
  unlockSubtitle: string;
  createSubtitle: string;
  masterPassword: string;
  confirmPassword: string;
  enterPassword: string;
  confirmPasswordPlaceholder: string;
  passwordsDoNotMatch: string;
  passwordTooShort: string;
  pleaseWait: string;
  unlock: string;
  create: string;
  addressBookLocation: string;
  recentFiles: string;
  open: string;
  saveAs: string;
  default_: string;
  selectAddressBookFile: string;
  chooseLocation: string;

  // Main page
  folder: string;
  connection: string;
  settings: string;
  lock: string;
  filterFolders: string;
  filterConnections: string;
  selectItemHint: string;
  noItemsYet: string;

  // Detail panel
  rustdeskId: string;
  password: string;
  description: string;
  items: string;
  connect: string;
  edit: string;
  delete_: string;
  copyId: string;
  copyInfo: string;
  copied: string;
  deleted: string;
  undo: string;

  // Context menu
  newFolder: string;
  newConnection: string;
  editFolder: string;
  deleteFolder: string;
  editConnection: string;
  deleteConnection: string;

  // Connection form
  editConnectionTitle: string;
  newConnectionTitle: string;
  name: string;
  namePlaceholder: string;
  rustdeskIdPlaceholder: string;
  passwordPlaceholder: string;
  descriptionPlaceholder: string;
  show: string;
  hide: string;
  save: string;
  addConnection: string;
  cancel: string;

  // Folder form
  editFolderTitle: string;
  newFolderTitle: string;
  folderNamePlaceholder: string;
  folderDescPlaceholder: string;
  addFolder: string;

  // Settings
  settingsTitle: string;
  rustdeskExecutable: string;
  path: string;
  pathPlaceholder: string;
  autoDetect: string;
  updates: string;
  autoCheckUpdates: string;
  changeMasterPassword: string;
  currentPassword: string;
  newPassword: string;
  confirmNewPassword: string;
  changePassword: string;
  language: string;
  rustdeskPathSaved: string;
  detected: (path: string) => string;
  newPasswordsDoNotMatch: string;
  passwordChangedSuccessfully: string;

  // Export / Import
  export_: string;
  import_: string;
  exportConfirm: string;
  exportCancel: string;
  selectAll: string;
  deselectAll: string;
  exportPasswordTitle: string;
  exportPasswordHint: string;
  exportSuccess: string;
  importSuccess: string;
  importPasswordTitle: string;
  importPasswordHint: string;
  noNodesSelected: string;
  saveExportFile: string;
  selectImportFile: string;

  // Subscriptions
  subscriptions: string;
  addSubscription: string;
  editSubscription: string;
  removeSubscription: string;
  subscriptionName: string;
  subscriptionUrl: string;
  subscriptionKey: string;
  subscriptionNamePlaceholder: string;
  subscriptionUrlPlaceholder: string;
  subscriptionKeyPlaceholder: string;
  syncNow: string;
  syncing: string;
  syncSuccess: string;
  syncError: string;
  syncVersionError: string;
  syncReadOnly: string;
  lastSynced: string;
  never: string;
  removeSubscriptionConfirm: string;
  noSubscriptions: string;

  // Access tokens
  manageAccess: string;
  accessTokens: string;
  createToken: string;
  revokeToken: string;
  tokenLabel: string;
  tokenPermissions: string;
  readWrite: string;
  readOnly: string;
  tokenCreated: string;
  tokenRevoked: string;
  copyToken: string;
  tokenCopied: string;
  noTokens: string;
  accessToken: string;
  accessTokenPlaceholder: string;
  tokenLabelPlaceholder: string;
  admin: string;
  revokeConfirm: string;
}

const I18nContext = createContext<Translations>(null!);

export const I18nProvider = I18nContext.Provider;

export function useI18n(): Translations {
  return useContext(I18nContext);
}
