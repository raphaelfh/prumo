/**
 * Diálogo para Criar Novo Projeto
 */

import {useForm} from "react-hook-form";
import {zodResolver} from "@hookform/resolvers/zod";
import {z} from "zod";
import {AppDialog} from "@/components/patterns/AppDialog";
import {Form, FormControl, FormField, FormItem, FormLabel, FormMessage,} from "@/components/ui/form";
import {Input} from "@/components/ui/input";
import {Textarea} from "@/components/ui/textarea";
import {Alert, AlertDescription} from "@/components/ui/alert";
import {Info} from "lucide-react";

const schema = z.object({
    name: z
        .string()
        .min(1, "Nome do projeto é obrigatório")
        .min(3, "Nome deve ter pelo menos 3 caracteres")
        .max(100, "Nome muito longo (máximo 100 caracteres)"),
    description: z
        .string()
        .max(500, "Descrição muito longa (máximo 500 caracteres)")
        .optional(),
});

type FormValues = z.infer<typeof schema>;

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
          title="Criar Novo Projeto"
          description="Configure seu projeto de revisão sistemática"
          size="md"
          onConfirm={form.handleSubmit(onSubmit)}
          confirmLabel={isCreating ? "Criando..." : "Criar Projeto"}
          cancelLabel="Cancelar"
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
                                  Nome do Projeto <span className="text-destructive">*</span>
                              </FormLabel>
                              <FormControl>
                                  <Input
                                      {...field}
                                      placeholder="Ex: Revisão Sistemática sobre Diabetes Tipo 2"
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
                                  Descrição{" "}
                                  <span className="text-muted-foreground text-xs">(opcional)</span>
                              </FormLabel>
                              <FormControl>
                                  <Textarea
                                      {...field}
                                      placeholder="Breve descrição sobre o objetivo desta revisão..."
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
                          Você poderá adicionar mais detalhes nas configurações do projeto após a criação.
                      </AlertDescription>
                  </Alert>
        </form>
          </Form>
      </AppDialog>
  );
}
