import clsx from "clsx";
import { CloudUpload } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { ACCEPT_ATTRIBUTE } from "./validateFile";

interface Props {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}

export function UploadDropzone({ onFiles, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    onFiles(Array.from(event.dataTransfer.files));
  };

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={clsx(
        "rounded-card border bg-surface/40 transition-colors",
        dragging ? "border-accent bg-accent-row" : "border-line-strong",
      )}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="flex w-full flex-col items-center gap-2 px-6 py-6 text-center disabled:cursor-not-allowed disabled:opacity-60"
      >
        <CloudUpload aria-hidden className="size-5 text-ink/70" strokeWidth={1.75} />
        <span className="text-[13px] font-medium">파일을 끌어다 놓거나 클릭해 추가</span>
        <span className="text-xs text-muted">PDF · DOCX · YAML · JSON · CSV, 파일당 20MB 이하 · AWS S3에 저장</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        accept={ACCEPT_ATTRIBUTE}
        data-testid="dropzone-input"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
    </div>
  );
}
