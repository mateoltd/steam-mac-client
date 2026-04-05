import React, { useState, useRef, useEffect } from 'react';
import { IPC } from '../../shared/ipc-channels';

interface HistoryEntry {
  type: 'cmd' | 'output' | 'error';
  text: string;
}

export function DebugPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<'shell' | 'eval'>('shell');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [cmdIndex, setCmdIndex] = useState(-1);
  const outputRef = useRef<HTMLPreElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [history]);

  if (!open) return null;

  const run = async () => {
    const cmd = input.trim();
    if (!cmd) return;

    setHistory(h => [...h, { type: 'cmd', text: `${mode === 'shell' ? '$' : '>'} ${cmd}` }]);
    setCmdHistory(h => [cmd, ...h]);
    setCmdIndex(-1);
    setInput('');

    const channel = mode === 'shell' ? IPC.DEBUG_EXEC : IPC.DEBUG_EVAL;
    const result = await window.electronAPI.invoke(channel, cmd) as any;

    if (result.output) {
      setHistory(h => [...h, { type: 'output', text: result.output }]);
    }
    if (result.error) {
      setHistory(h => [...h, { type: 'error', text: result.error }]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      run();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.min(cmdIndex + 1, cmdHistory.length - 1);
      setCmdIndex(next);
      if (cmdHistory[next]) setInput(cmdHistory[next]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = cmdIndex - 1;
      setCmdIndex(next);
      setInput(next < 0 ? '' : cmdHistory[next] || '');
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#1a1a1a] rounded-xl shadow-2xl border border-white/10 w-[700px] h-[500px] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-white/10">
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-red-400">DEBUG MODE</span>
            <div className="flex gap-0.5 bg-white/5 rounded p-0.5">
              <button
                onClick={() => setMode('shell')}
                className={`px-2 py-0.5 rounded text-[11px] font-mono ${mode === 'shell' ? 'bg-white/10 text-white' : 'text-white/40'}`}
              >
                Shell
              </button>
              <button
                onClick={() => setMode('eval')}
                className={`px-2 py-0.5 rounded text-[11px] font-mono ${mode === 'eval' ? 'bg-white/10 text-white' : 'text-white/40'}`}
              >
                JS Eval
              </button>
            </div>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white text-sm">✕</button>
        </div>

        {/* Output */}
        <pre
          ref={outputRef}
          className="flex-1 overflow-y-auto p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap"
        >
          {history.length === 0 && (
            <span className="text-white/20">
              Debug console. Shell runs bash commands, JS Eval runs in the main process.{'\n'}
              Cmd+Shift+D to toggle. Arrow up/down for history.
            </span>
          )}
          {history.map((entry, i) => (
            <div
              key={i}
              className={
                entry.type === 'cmd' ? 'text-blue-400' :
                entry.type === 'error' ? 'text-red-400' :
                'text-green-300/80'
              }
            >
              {entry.text}
            </div>
          ))}
        </pre>

        {/* Input */}
        <div className="flex items-center border-t border-white/10 px-3 py-2 gap-2">
          <span className="text-white/30 font-mono text-[12px]">{mode === 'shell' ? '$' : '>'}</span>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent text-white font-mono text-[12px] outline-none placeholder:text-white/20"
            placeholder={mode === 'shell' ? 'ls -la, cat /etc/os-release, ...' : 'require("os").arch(), ...'}
            spellCheck={false}
          />
        </div>
      </div>
    </div>
  );
}
