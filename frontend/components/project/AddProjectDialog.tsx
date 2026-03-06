/**
 * Dialog for creating a new project.
 */

import {useMemo} from "react";
import {useForm} from "react-hook-form";
import {zodResolver} from "@hookform/resolvers/zod";
import {z} from "zod";
import {AppDialog} from "@/components/patterns/AppDialog";
import {Form, FormControl, FormField, FormItem, FormLabel, FormMessage} from "@/components/ui/form";
import {Input} from "@/components/ui/input";
import {Textarea} from "@/components/ui/textarea";
import {Alert, AlertDescription} from "@/components/ui/alert";
import {Info} from "lucide-react";
import {t} from "@/lib/copy";

type FormValues = {
    name: string;
    description?: string;
};

interface AddProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
    onProjectCreate: (data: { name: string; description?: string }) => Promise<void>;
  isCreating?: boolean;
}

export function AddProjectDialog({
                                     open,
                                     onOpenChange,
  onProjectCreate,
                                     isCreating = false,
}: AddProjectDialogProps) {
    const schema = useMemo(
        () =>
            z.object({
                name: z
                    .string()
                    .min(1, t("project", "addDialogNameRequired"))
                    .min(3, t("project", "addDialogNameMinLength"))
                    .max(100, t("project", "addDialogNameMaxLength")),
                description: z
                    .string()
                    .max(500, t("project", "addDialogDescriptionMaxLength"))
                    .optional(),
            }),
        []
    );

    const form = useForm<FormValues>({
        resolver: zodResolver(schema),
        defaultValues: {name: "", description: ""},
    });

    const descriptionValue = form.watch("description") ?? "";

    const onSubmit = async (values: FormValues) => {
    await onProjectCreate({
        name: values.name.trim(),
        description: values.description?.trim() || undefined,
    });
        form.reset();
  };

    const handleOpenChange = (isOpen: boolean) => {
        if (!isOpen) form.reset();
        onOpenChange(isOpen);
  };

  return (
      <AppDialog
          open={open}
          onOpenChange={handleOpenChange}
          title={t("project", "addDialogTitle")}
          description={t("project", "addDialogDescription")}
          size="md"
          onConfirm={form.handleSubmit(onSubmit)}
          confirmLabel={isCreating ? t("project", "addDialogCreating") : t("project", "addDialogCreateProject")}
          cancelLabel={t("common", "cancel")}
          isLoading={isCreating}
      >
          <Form {...form}>
              <form className="space-y-4">
                  <FormField
                      control={form.control}
                      name="name"
                      render={({field}) => (
                          <FormItem>
                              <FormLabel>
                                  {t("project", "addDialogNameLabel")} <span className="text-destructive">*</span>
                              </FormLabel>
                              <FormControl>
                                  <Input
                                      {...field}
                                      placeholder={t("project", "addDialogNamePlaceholder")}
                                      disabled={isCreating}
                                      autoFocus
                                      maxLength={100}
                                  />
                              </FormControl>
                              <FormMessage/>
                          </FormItem>
                      )}
                  />

                  <FormField
                      control={form.control}
                      name="description"
                      render={({field}) => (
                          <FormItem>
                              <FormLabel>
                                  {t("project", "addDialogDescriptionLabel")}{" "}
                                  <span
                                      className="text-muted-foreground text-xs">({t("project", "addDialogOptional")})</span>
                              </FormLabel>
                              <FormControl>
                                  <Textarea
                                      {...field}
                                      placeholder={t("project", "addDialogDescriptionPlaceholder")}
                                      rows={3}
                                      disabled={isCreating}
                                      className="resize-none"
                                      maxLength={500}
                                  />
                              </FormControl>
                              <p className="text-xs text-muted-foreground text-right">
                                  {descriptionValue.length}/500
                              </p>
                              <FormMessage/>
                          </FormItem>
                      )}
                  />

                  <Alert>
                      <Info className="h-4 w-4"/>
                      <AlertDescription className="text-sm">
                          {t("project", "addDialogMoreDetailsAfter")}
                      </AlertDescription>
                  </Alert>
        </form>
          </Form>
      </AppDialog>
  );
}
