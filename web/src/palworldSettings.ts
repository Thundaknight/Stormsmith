/**
 * Metadata for PalWorldSettings.ini, grouped for the settings editor UI.
 * From https://docs.palworldgame.com/settings-and-operation/configuration
 * Settings found in the file but not listed here still appear in an "Other" group.
 */

export type SettingType = 'float' | 'int' | 'bool' | 'text' | 'password' | 'select';

export interface SettingDef {
  key: string;
  label: string;
  type: SettingType;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  help?: string;
}

export interface SettingGroup {
  name: string;
  settings: SettingDef[];
}

const rate = (key: string, label: string, max = 5, help?: string): SettingDef =>
  ({ key, label, type: 'float', min: 0.1, max, step: 0.1, help });

export const PALWORLD_SETTING_GROUPS: SettingGroup[] = [
  {
    name: 'General',
    settings: [
      { key: 'Difficulty', label: 'Difficulty', type: 'select', options: ['None', 'Casual', 'Normal', 'Hard'] },
      { key: 'RandomizerType', label: 'Pal randomizer', type: 'select', options: ['None', 'Region', 'All'] },
      { key: 'RandomizerSeed', label: 'Randomizer seed', type: 'text' },
      { key: 'bIsRandomizerPalLevelRandom', label: 'Random wild Pal levels', type: 'bool' },
      { key: 'bHardcore', label: 'Hardcore mode (no respawn)', type: 'bool' },
      { key: 'bCharacterRecreateInHardcore', label: 'Allow character recreate in Hardcore', type: 'bool' },
      rate('DayTimeSpeedRate', 'Day time speed'),
      rate('NightTimeSpeedRate', 'Night time speed'),
      rate('ExpRate', 'EXP rate', 20),
      rate('WorkSpeedRate', 'Work speed'),
    ],
  },
  {
    name: 'Pals',
    settings: [
      rate('PalCaptureRate', 'Capture rate'),
      rate('PalSpawnNumRate', 'Pal spawn count'),
      rate('PalDamageRateAttack', 'Pal damage dealt'),
      rate('PalDamageRateDefense', 'Pal damage taken'),
      rate('PalStomachDecreaceRate', 'Pal hunger drain'),
      rate('PalStaminaDecreaceRate', 'Pal stamina drain'),
      rate('PalAutoHPRegeneRate', 'Pal HP regen'),
      rate('PalAutoHpRegeneRateInSleep', 'Pal HP regen while sleeping'),
      { key: 'PalEggDefaultHatchingTime', label: 'Huge egg hatch time (hours)', type: 'float', min: 0, max: 240, step: 1 },
      { key: 'bPalLost', label: 'Permanently lose Pals on death', type: 'bool' },
      rate('MonsterFarmActionSpeedRate', 'Ranch production speed'),
    ],
  },
  {
    name: 'Player',
    settings: [
      rate('PlayerDamageRateAttack', 'Player damage dealt'),
      rate('PlayerDamageRateDefense', 'Player damage taken'),
      rate('PlayerStomachDecreaceRate', 'Player hunger drain'),
      rate('PlayerStaminaDecreaceRate', 'Player stamina drain'),
      rate('PlayerAutoHPRegeneRate', 'Player HP regen'),
      rate('PlayerAutoHpRegeneRateInSleep', 'Player HP regen while sleeping'),
      rate('ItemWeightRate', 'Item weight'),
      { key: 'DeathPenalty', label: 'Death penalty', type: 'select', options: ['None', 'Item', 'ItemAndEquipment', 'All'],
        help: 'What is dropped on death' },
      rate('RespawnPenaltyTimeScale', 'Respawn cooldown scale'),
      { key: 'bEnablePlayerToPlayerDamage', label: 'Player-to-player damage', type: 'bool' },
      { key: 'bEnableFriendlyFire', label: 'Friendly fire', type: 'bool' },
      { key: 'bAllowEnhanceStat_Attack', label: 'Allow stat points: Attack', type: 'bool' },
      { key: 'bAllowEnhanceStat_Health', label: 'Allow stat points: Health', type: 'bool' },
      { key: 'bAllowEnhanceStat_Stamina', label: 'Allow stat points: Stamina', type: 'bool' },
      { key: 'bAllowEnhanceStat_Weight', label: 'Allow stat points: Weight', type: 'bool' },
      { key: 'bAllowEnhanceStat_WorkSpeed', label: 'Allow stat points: Work speed', type: 'bool' },
    ],
  },
  {
    name: 'World & Items',
    settings: [
      rate('CollectionDropRate', 'Gathering drop rate'),
      rate('CollectionObjectHpRate', 'Gatherable object HP'),
      rate('CollectionObjectRespawnSpeedRate', 'Gatherable respawn speed'),
      rate('EnemyDropItemRate', 'Enemy item drops'),
      rate('BuildObjectDamageRate', 'Building damage'),
      rate('BuildObjectDeteriorationDamageRate', 'Building decay'),
      { key: 'DropItemMaxNum', label: 'Max dropped items in world', type: 'int', min: 0, max: 5000, step: 100 },
      { key: 'DropItemAliveMaxHours', label: 'Dropped item lifetime (hours)', type: 'float', min: 0, max: 24, step: 0.5 },
      { key: 'bEnableInvaderEnemy', label: 'Base raids', type: 'bool' },
      { key: 'SupplyDropSpan', label: 'Supply drop interval (minutes)', type: 'int', min: 10, max: 600, step: 10 },
      { key: 'BlockRespawnTime', label: 'Block respawn cooldown (seconds)', type: 'int', min: 0, max: 3600, step: 10 },
    ],
  },
  {
    name: 'Base & Guild',
    settings: [
      { key: 'BaseCampMaxNum', label: 'Max bases on server', type: 'int', min: 1, max: 1024, step: 1 },
      { key: 'BaseCampMaxNumInGuild', label: 'Max bases per guild', type: 'int', min: 1, max: 10, step: 1 },
      { key: 'BaseCampWorkerMaxNum', label: 'Max worker Pals per base', type: 'int', min: 1, max: 50, step: 1 },
      { key: 'GuildPlayerMaxNum', label: 'Max guild members', type: 'int', min: 1, max: 100, step: 1 },
      { key: 'MaxBuildingLimitNum', label: 'Building limit per player (0 = unlimited)', type: 'int', min: 0, max: 10000, step: 100 },
      { key: 'bBuildAreaLimit', label: 'Restrict building near fast travel', type: 'bool' },
      { key: 'bAutoResetGuildNoOnlinePlayers', label: 'Auto-reset inactive guilds', type: 'bool' },
      { key: 'AutoResetGuildTimeNoOnlinePlayers', label: 'Guild reset time (hours)', type: 'float', min: 1, max: 720, step: 1 },
      { key: 'bEnableBuildingPlayerUIdDisplay', label: 'Show builder IDs on structures', type: 'bool' },
    ],
  },
  {
    name: 'Multiplayer',
    settings: [
      { key: 'ServerName', label: 'Server name', type: 'text' },
      { key: 'ServerDescription', label: 'Server description', type: 'text' },
      { key: 'ServerPassword', label: 'Join password', type: 'password' },
      { key: 'AdminPassword', label: 'Admin password', type: 'password', help: 'Also used as the RCON password' },
      { key: 'ServerPlayerMaxNum', label: 'Max players', type: 'int', min: 1, max: 32, step: 1 },
      { key: 'CoopPlayerMaxNum', label: 'Max co-op players', type: 'int', min: 1, max: 8, step: 1 },
      { key: 'bIsPvP', label: 'PvP', type: 'bool' },
      { key: 'bEnableFastTravel', label: 'Fast travel', type: 'bool' },
      { key: 'bEnableFastTravelOnlyBaseCamp', label: 'Fast travel between bases only', type: 'bool' },
      { key: 'bIsStartLocationSelectByMap', label: 'Choose start location on map', type: 'bool' },
      { key: 'bExistPlayerAfterLogout', label: 'Keep player in world after logout', type: 'bool' },
      { key: 'bIsShowJoinLeftMessage', label: 'Show join/leave messages', type: 'bool' },
      { key: 'ChatPostLimitPerMinute', label: 'Chat messages per minute limit', type: 'int', min: 0, max: 120, step: 1 },
      { key: 'bAllowClientMod', label: 'Allow modded clients', type: 'bool' },
      { key: 'CrossplayPlatforms', label: 'Crossplay platforms', type: 'text', help: 'e.g. (Steam,Xbox,PS5,Mac)' },
      { key: 'bCanPickupOtherGuildDeathPenaltyDrop', label: 'Loot other guilds’ death drops', type: 'bool' },
      { key: 'bEnableDefenseOtherGuildPlayer', label: 'Defend against other guild players', type: 'bool' },
      { key: 'bEnableNonLoginPenalty', label: 'Non-login penalty', type: 'bool' },
    ],
  },
  {
    name: 'Network & System',
    settings: [
      { key: 'PublicIP', label: 'Public IP', type: 'text' },
      { key: 'PublicPort', label: 'Public port', type: 'int', min: 1, max: 65535, step: 1 },
      { key: 'RCONEnabled', label: 'RCON enabled', type: 'bool' },
      { key: 'RCONPort', label: 'RCON port', type: 'int', min: 1, max: 65535, step: 1 },
      { key: 'RESTAPIEnabled', label: 'REST API enabled', type: 'bool' },
      { key: 'RESTAPIPort', label: 'REST API port', type: 'int', min: 1, max: 65535, step: 1 },
      { key: 'Region', label: 'Region', type: 'text' },
      { key: 'bUseAuth', label: 'Use authentication', type: 'bool' },
      { key: 'BanListURL', label: 'Ban list URL', type: 'text' },
      { key: 'bIsUseBackupSaveData', label: 'World backups', type: 'bool' },
      { key: 'bShowPlayerList', label: 'Show player list', type: 'bool' },
      { key: 'LogFormatType', label: 'Log format', type: 'select', options: ['Text', 'Json'] },
      { key: 'ServerReplicatePawnCullDistance', label: 'Pal sync distance (cm)', type: 'int', min: 5000, max: 15000, step: 500 },
      { key: 'ItemContainerForceMarkDirtyInterval', label: 'Container re-sync interval (s)', type: 'float', min: 0.1, max: 60, step: 0.1 },
      { key: 'PhysicsActiveDropItemMaxNum', label: 'Max physics drop items', type: 'int', min: 0, max: 1000, step: 10 },
    ],
  },
];

export const KNOWN_KEYS = new Set(
  PALWORLD_SETTING_GROUPS.flatMap((g) => g.settings.map((s) => s.key))
);
