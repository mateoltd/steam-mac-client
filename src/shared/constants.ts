import type { DLLLoadOrder, WindowsVersion, WineBackend } from './types';

export const WINE_BACKENDS: { value: WineBackend; label: string }[] = [
  { value: 'gptk', label: 'Game Porting Toolkit' },
  { value: 'crossover', label: 'CrossOver Wine' },
  { value: 'custom', label: 'Custom Wine Path' },
];

export const WINDOWS_VERSIONS: { value: WindowsVersion; label: string }[] = [
  { value: 'win10', label: 'Windows 10' },
  { value: 'win81', label: 'Windows 8.1' },
  { value: 'win8', label: 'Windows 8' },
  { value: 'win7', label: 'Windows 7' },
];

export const DLL_LOAD_ORDERS: { value: DLLLoadOrder; label: string }[] = [
  { value: 'n', label: 'Native' },
  { value: 'b', label: 'Builtin' },
  { value: 'n,b', label: 'Native, Builtin' },
  { value: 'b,n', label: 'Builtin, Native' },
  { value: '', label: 'Disabled' },
];

export const STEAM_PROMPT_INFO: Record<string, { title: string; description: string; placeholder: string }> = {
  twoFactorAuth: {
    title: 'Steam Guard - Authenticator',
    description: 'Enter the code from your Steam Mobile Authenticator app.',
    placeholder: '2FA Code',
  },
  emailCode: {
    title: 'Steam Guard - Email Code',
    description: 'A verification code was sent to your email. Enter it below.',
    placeholder: 'Email Code',
  },
  smsCode: {
    title: 'Steam Guard - SMS Code',
    description: 'A verification code was sent via SMS. Enter it below.',
    placeholder: 'SMS Code',
  },
  password: {
    title: 'Enter Password',
    description: 'Enter your Steam password.',
    placeholder: 'Password',
  },
};
