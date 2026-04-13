import { Shuffle, Tag, X } from "lucide-react";

import type {
  AccountListItem,
  GroupInfo,
} from "@/types/database";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface DatabaseEditGroupDialogProps {
  editingAccount: AccountListItem | null;
  groups: GroupInfo[];
  editGroupName: string;
  editGroupColor: string;
  onEditGroupNameChange: (value: string) => void;
  onEditGroupColorChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void | Promise<void>;
}

export function DatabaseEditGroupDialog({
  editingAccount,
  groups,
  editGroupName,
  editGroupColor,
  onEditGroupNameChange,
  onEditGroupColorChange,
  onClose,
  onSave,
}: DatabaseEditGroupDialogProps) {
  return (
    <Dialog open={!!editingAccount} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="[&>button]:hidden">
        <div className="absolute right-4 top-4">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 opacity-70 hover:opacity-100"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <DialogHeader>
          <DialogTitle>Edit Group for @{editingAccount?.username}</DialogTitle>
          <DialogDescription>
            Assign this account to a group for better organization.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="groupName">Group Name</Label>
            <div className="flex items-center gap-2">
              <Input
                id="groupName"
                placeholder="e.g., Artists, Photographers, Friends"
                value={editGroupName}
                onChange={(event) => onEditGroupNameChange(event.target.value)}
                className="flex-1"
              />
              {groups.length > 0 ? (
                <Select
                  value=""
                  onValueChange={(value) => {
                    onEditGroupNameChange(value);
                    const group = groups.find((entry) => entry.name === value);
                    if (group) {
                      onEditGroupColorChange(group.color);
                    }
                  }}
                >
                  <SelectTrigger className="w-auto">
                    <Tag className="h-4 w-4" />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((group) => (
                      <SelectItem key={group.name} value={group.name}>
                        <span className="flex items-center gap-2">
                          <span
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: group.color }}
                          />
                          {group.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              {editGroupName ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        onEditGroupNameChange("");
                        onEditGroupColorChange("#3b82f6");
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Remove from Group</TooltipContent>
                </Tooltip>
              ) : null}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="groupColor">Group Color</Label>
            <div className="flex items-center gap-3">
              <div className="relative h-10 w-10">
                <input
                  id="groupColor"
                  type="color"
                  value={editGroupColor}
                  onChange={(event) => onEditGroupColorChange(event.target.value)}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
                <div
                  className="h-10 w-10 cursor-pointer rounded-full border-2 border-border"
                  style={{ backgroundColor: editGroupColor }}
                />
              </div>
              <Input
                value={editGroupColor}
                onChange={(event) => onEditGroupColorChange(event.target.value)}
                placeholder="#3b82f6"
                className="w-28 font-mono text-sm"
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => {
                      const randomColor =
                        "#" +
                        Math.floor(Math.random() * 16777215)
                          .toString(16)
                          .padStart(6, "0");
                      onEditGroupColorChange(randomColor);
                    }}
                  >
                    <Shuffle className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Random Color</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void onSave()}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
