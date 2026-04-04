// Request-response channels (renderer invokes, main responds)
export const IPC = {
  SEARCH_GAMES: 'search:query',
  GET_DEPOTS: 'depot:get',
  LOCATE_TOOLS: 'tools:locate',
  GET_SETTINGS: 'settings:get',
  SET_SETTINGS: 'settings:set',
  PICK_DIRECTORY: 'settings:pick-directory',
  FIND_EXECUTABLES: 'launch:find-exes',
  CHECK_STEAM_IN_PREFIX: 'launch:check-steam',
  INSTALL_STEAM_IN_PREFIX: 'launch:install-steam',
  LAUNCH_STEAM_IN_PREFIX: 'launch:start-steam',
  REPAIR_STEAM_IN_PREFIX: 'launch:repair-steam',
  GET_ARCHITECTURE: 'platform:arch',

  // Actions (renderer triggers)
  START_DOWNLOAD: 'download:start',
  CANCEL_DOWNLOAD: 'download:cancel',
  SUBMIT_AUTH_CODE: 'download:submit-auth',
  LAUNCH_GAME: 'launch:game',
  INSTALL_TOOLS: 'tools:install-all',
  INSTALL_SINGLE_TOOL: 'tools:install-single',
  REINSTALL_ALL: 'tools:reinstall-all',
  REVEAL_IN_FINDER: 'shell:reveal',

  // Streaming channels (main pushes to renderer)
  DOWNLOAD_PROGRESS: 'download:progress',
  DOWNLOAD_LOG: 'download:log',
  DOWNLOAD_STATUS: 'download:status',
  DOWNLOAD_AUTH_PROMPT: 'download:auth-prompt',
  INSTALL_PROGRESS: 'install:progress',
  INSTALL_LOG: 'install:log',
} as const;
