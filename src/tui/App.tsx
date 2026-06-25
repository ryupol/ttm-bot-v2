import React from "react";
import { Box, Text } from "ink";
import type { BotSnapshot, LogEntry } from "../ipc/types.js";
import { BotGrid } from "./BotGrid.js";
import { CommandInput } from "./CommandInput.js";
import { LogPanel } from "./LogPanel.js";

type Props = {
  bots: BotSnapshot[];
  logs: LogEntry[];
  selectedLogBot?: number;
  scheduledStart?: string;
  onCommand: (command: string) => void;
};

export function App({ bots, logs, selectedLogBot, scheduledStart, onCommand }: Props): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={1}>
      <BotGrid bots={bots} />
      {scheduledStart ? (
        <Text color="yellow">Scheduled start: {scheduledStart}</Text>
      ) : (
        <Text dimColor>No scheduled start</Text>
      )}
      <LogPanel logs={logs} filterBot={selectedLogBot} />
      <Text dimColor>Commands: prepare all | go all | stop N | reset N | assign N | log N | set-time HH:MM:SS</Text>
      <CommandInput onCommand={onCommand} />
    </Box>
  );
}
