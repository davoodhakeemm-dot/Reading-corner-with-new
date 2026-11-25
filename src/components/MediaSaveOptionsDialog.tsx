import { FolderPlus, Lock, Smartphone } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { GalleryScope } from "@/lib/social-logic";

export function MediaSaveOptionsDialog({
  open,
  name,
  saveable,
  onOpenChange,
  onSaveToGallery,
  onDownloadToPhone,
}: {
  open: boolean;
  name: string;
  saveable: boolean;
  onOpenChange: (open: boolean) => void;
  onSaveToGallery: (scope: GalleryScope) => Promise<void>;
  onDownloadToPhone: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);

  async function runAction(action: () => Promise<void>, successMessage: string) {
    setSaving(true);
    try {
      await action();
      toast.success(successMessage);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save this media.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !saving && onOpenChange(nextOpen)}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle>Save media</DialogTitle>
          <DialogDescription className="break-all">Choose where to save {name}.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {saveable && (
            <>
              <Button
                type="button"
                variant="secondary"
                className="min-h-12 justify-start"
                disabled={saving}
                onClick={() =>
                  void runAction(() => onSaveToGallery("secret"), "Saved to your Secret Gallery")
                }
              >
                <Lock data-icon="inline-start" />
                1. Save to Secret Gallery
              </Button>
              <Button
                type="button"
                className="min-h-12 justify-start"
                disabled={saving}
                onClick={() =>
                  void runAction(() => onSaveToGallery("normal"), "Saved to your Normal Gallery")
                }
              >
                <FolderPlus data-icon="inline-start" />
                2. Save to Normal Gallery
              </Button>
            </>
          )}
          <Button
            type="button"
            variant="outline"
            className="min-h-12 justify-start"
            disabled={saving}
            onClick={() => void runAction(onDownloadToPhone, "Download started")}
          >
            <Smartphone data-icon="inline-start" />
            Download to phone
          </Button>
          <p className="text-xs text-muted-foreground">
            Saved items stay private to your account. Downloads save a local copy via your browser.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
