import React from "react";
import { Box, Text } from "ink";
import type { BotSnapshot, LogEntry } from "../ipc/types.ts";
import { BotGrid } from "./BotGrid.tsx";
import { CommandInput } from "./CommandInput.tsx";
import { LogPanel } from "./LogPanel.tsx";

type Props = {
  bots: BotSnapshot[];
  logs: LogEntry[];
  selectedLogBot?: number;
  onCommand: (command: string) => void;
};

export function App({ bots, logs, selectedLogBot, onCommand }: Props): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={1}>
      <BotGrid bots={bots} />
      <LogPanel logs={logs} filterBot={selectedLogBot} />
      <Text dimColor>Commands: login all | check all | go N/all | stop N/all | reset N/all | log N/all</Text>
      <CommandInput onCommand={onCommand} />
    </Box>
  );
}
