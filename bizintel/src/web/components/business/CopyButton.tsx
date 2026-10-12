import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { IconButton } from "../ui/Button";
import { useToast } from "../ui/Toast";

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  return (
    <IconButton
      label={copied ? "Copied" : label}
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Couldn’t copy", "Your browser blocked clipboard access.");
        }
      }}
    >
      {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
    </IconButton>
  );
}
