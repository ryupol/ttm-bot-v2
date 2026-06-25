import React, { useState } from "react";
import { Box, Text, useApp, useInput } from "ink";

type Props = {
  onCommand: (command: string) => void;
};

export function CommandInput({ onCommand }: Props): React.ReactElement {
  const [value, setValue] = useState("");
  const { exit } = useApp();

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      return;
    }

    if (key.return) {
      const command = value.trim();
      if (command) onCommand(command);
      setValue("");
      return;
    }

    if (key.backspace || key.delete) {
      setValue((current) => current.slice(0, -1));
      return;
    }

    if (input && !key.meta && !key.ctrl) setValue((current) => current + input);
  });

  return (
    <Box marginTop={1}>
      <Text color="green">&gt; </Text>
      <Text>{value}</Text>
    </Box>
  );
}
