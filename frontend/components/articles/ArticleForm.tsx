/**
 * ArticleForm - Componente Unificado para Adicionar/Editar Artigos
 * 
 * Sistema moderno com:
 * - Tela cheia ao invés de modal
 * - Navegação por etapas com submenus laterais
 * - Reutilização de componente para adicionar/editar
 * - Interface responsiva e intuitiva
 */

import {useEffect, useState} from "react";
import {useNavigate} from "react-router-dom";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Textarea} from "@/components/ui/textarea";
import {Badge} from "@/components/ui/badge";
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card";
import {ScrollArea} from "@/components/ui/scroll-area";
import {Alert, AlertDescription} from "@/components/ui/alert";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {supabase} from "@/integrations/supabase/client";
import {toast} from "sonner";
import {
    AlertCircle,
    ArrowLeft,
    BookOpen,
    Download,
    Eye,
    FileText,
    Hash,
    Loader2,
    Plus,
    Save,
    Tag,
    Trash2,
    Upload
} from "lucide-react";
import {useAuth} from "@/contexts/AuthContext";
import {ArticleFileUploadDialogNew} from './ArticleFileUploadDialogNew';

interface Article {
  id: string;
  title: string;
  abstract: string | null;
  authors: string[] | null;
  publication_year: number | null;
  publication_month: number | null;
  publication_day: number | null;
  journal_title: string | null;
  journal_issn: string | null;
  journal_eissn: string | null;
  journal_publisher: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  doi: string | null;
  pmid: string | null;
  pmcid: string | null;
  keywords: string[] | null;
  url_landing: string | null;
  url_pdf: string | null;
  language: string | null;
  article_type: string | null;
  publication_status: string | null;
  open_access: boolean | null;
  license: string | null;
  arxiv_id: string | null;
  pii: string | null;
  mesh_terms: string[] | null;
  study_design: string | null;
  conflicts_of_interest: string | null;
  data_availability: string | null;
}

interface ArticleFile {
  id: string;
  file_type: string;
  file_role: string;
  storage_key: string;
  original_filename: string | null;
  bytes: number | null;
}

interface ArticleFormProps {
  mode: 'add' | 'edit';
  projectId: string;
  articleId?: string;
  onComplete?: () => void;
}

type FormStep = 'basic' | 'publication' | 'identifiers' | 'additional' | 'files';

interface FormData {
  title: string;
  abstract: string;
  authors: string;
  publication_year: string;
  publication_month: string;
  publication_day: string;
  journal_title: string;
  journal_issn: string;
  journal_eissn: string;
  journal_publisher: string;
  volume: string;
  issue: string;
  pages: string;
  doi: string;
  pmid: string;
  pmcid: string;
  arxiv_id: string;
  pii: string;
  keywords: string;
  mesh_terms: string;
  url_landing: string;
  language: string;
  article_type: string;
  publication_status: string;
  study_design: string;
  conflicts_of_interest: string;
  data_availability: string;
  open_access: boolean;
  license: string;
}

const STEPS: { id: FormStep; label: string; icon: any; description: string }[] = [
  {
    id: 'basic',
    label: 'Informações Básicas',
    icon: FileText,
    description: 'Título, resumo e autores'
  },
  {
    id: 'publication',
    label: 'Publicação',
    icon: BookOpen,
    description: 'Revista, volume e páginas'
  },
  {
    id: 'identifiers',
    label: 'Identificadores',
    icon: Hash,
    description: 'DOI, PMID e outros IDs'
  },
  {
    id: 'additional',
    label: 'Informações Adicionais',
    icon: Tag,
    description: 'Palavras-chave e metadados'
  },
  {
    id: 'files',
    label: 'Arquivos',
    icon: Upload,
    description: 'PDFs e documentos'
  }
];

export function ArticleForm({ mode, projectId, articleId, onComplete }: ArticleFormProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  
  // Estado principal
  const [currentStep, setCurrentStep] = useState<FormStep>('basic');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [article, setArticle] = useState<Article | null>(null);
  const [files, setFiles] = useState<ArticleFile[]>([]);
  const [showFileUpload, setShowFileUpload] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<ArticleFile | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingFile, setDeletingFile] = useState(false);
  
  // Estado para erros de validação
  const [validationErrors, setValidationErrors] = useState<{
    publication_year?: string;
    publication_month?: string;
    publication_day?: string;
  }>({});
  
  // Formulário
  const [formData, setFormData] = useState<FormData>({
    title: '',
    abstract: '',
    authors: '',
    publication_year: '',
    publication_month: '',
    publication_day: '',
    journal_title: '',
    journal_issn: '',
    journal_eissn: '',
    journal_publisher: '',
    volume: '',
    issue: '',
    pages: '',
    doi: '',
    pmid: '',
    pmcid: '',
    arxiv_id: '',
    pii: '',
    keywords: '',
    mesh_terms: '',
    url_landing: '',
    language: '',
    article_type: '',
    publication_status: '',
    study_design: '',
    conflicts_of_interest: '',
    data_availability: '',
    open_access: false,
    license: ''
  });

  // Carregar dados do artigo (modo edição)
  useEffect(() => {
    if (mode === 'edit' && articleId) {
      loadArticle();
      loadFiles();
    }
  }, [mode, articleId]);

  const loadArticle = async () => {
    if (!articleId) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("articles")
        .select("*")
        .eq("id", articleId)
        .single();

      if (error) throw error;
      
      setArticle(data);
      
      // Preencher formulário
      setFormData({
        title: data.title || '',
        abstract: data.abstract || '',
        authors: data.authors?.join(', ') || '',
        publication_year: data.publication_year?.toString() || '',
        publication_month: data.publication_month?.toString() || '',
        publication_day: data.publication_day?.toString() || '',
        journal_title: data.journal_title || '',
        journal_issn: data.journal_issn || '',
        journal_eissn: data.journal_eissn || '',
        journal_publisher: data.journal_publisher || '',
        volume: data.volume || '',
        issue: data.issue || '',
        pages: data.pages || '',
        doi: data.doi || '',
        pmid: data.pmid || '',
        pmcid: data.pmcid || '',
        arxiv_id: data.arxiv_id || '',
        pii: data.pii || '',
        keywords: data.keywords?.join(', ') || '',
        mesh_terms: data.mesh_terms?.join(', ') || '',
        url_landing: data.url_landing || '',
        language: data.language || '',
        article_type: data.article_type || '',
        publication_status: data.publication_status || '',
        study_design: data.study_design || '',
        conflicts_of_interest: data.conflicts_of_interest || '',
        data_availability: data.data_availability || '',
        open_access: data.open_access || false,
        license: data.license || ''
      });
    } catch (error: any) {
      console.error("Error loading article:", error);
      toast.error("Erro ao carregar artigo");
    } finally {
      setLoading(false);
    }
  };

  const loadFiles = async () => {
    if (!articleId) return;

    try {
      const { data, error } = await supabase
        .from("article_files")
        .select("*")
        .eq("article_id", articleId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setFiles(data || []);
    } catch (error: any) {
      console.error("Error loading files:", error);
    }
  };

  // Validação de campos de data
  const validateDateField = (field: 'publication_year' | 'publication_month' | 'publication_day', value: string): string | undefined => {
    if (!value || value.trim() === '') {
      // Campo vazio é válido (opcional)
      setValidationErrors(prev => ({ ...prev, [field]: undefined }));
      return undefined;
    }

    const num = parseInt(value.trim(), 10);
    if (isNaN(num)) {
      const error = 'Deve ser um número válido';
      setValidationErrors(prev => ({ ...prev, [field]: error }));
      return error;
    }

    let error: string | undefined;
    if (field === 'publication_month') {
      if (num < 1 || num > 12) {
        error = 'Mês deve estar entre 1 e 12';
      }
    } else if (field === 'publication_day') {
      if (num < 1 || num > 31) {
        error = 'Dia deve estar entre 1 e 31';
      }
    } else if (field === 'publication_year') {
      if (num < 1600 || num > 2500) {
        error = 'Ano deve estar entre 1600 e 2500';
      }
    }

    setValidationErrors(prev => ({ ...prev, [field]: error }));
    return error;
  };

  // Handler para mudanças nos campos de data com validação
  const handleDateFieldChange = (field: 'publication_year' | 'publication_month' | 'publication_day', value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    validateDateField(field, value);
  };

  const handleSave = async () => {
    if (!formData.title.trim()) {
      toast.error("O título é obrigatório");
      setCurrentStep('basic');
      return;
    }

    // Validar todos os campos de data antes de salvar
    const yearError = validateDateField('publication_year', formData.publication_year);
    const monthError = validateDateField('publication_month', formData.publication_month);
    const dayError = validateDateField('publication_day', formData.publication_day);

    if (yearError || monthError || dayError) {
      toast.error("Por favor, corrija os erros nos campos de data antes de salvar");
      setCurrentStep('publication');
      return;
    }

    setSaving(true);
    try {
      // Helper para validar e converter valores numéricos de data
      const parseDateValue = (value: string | undefined): number | null => {
        if (!value || value.trim() === '') return null;
        const num = parseInt(value.trim(), 10);
        if (isNaN(num)) return null;
        return num;
      };

      // Validar publication_month (deve estar entre 1-12)
      const parsedMonth = parseDateValue(formData.publication_month);
      const validMonth = parsedMonth !== null && parsedMonth >= 1 && parsedMonth <= 12 ? parsedMonth : null;

      // Validar publication_day (deve estar entre 1-31)
      const parsedDay = parseDateValue(formData.publication_day);
      const validDay = parsedDay !== null && parsedDay >= 1 && parsedDay <= 31 ? parsedDay : null;

      // Validar publication_year (deve estar entre 1600-2500)
      const parsedYear = parseDateValue(formData.publication_year);
      const validYear = parsedYear !== null && parsedYear >= 1600 && parsedYear <= 2500 ? parsedYear : null;

      const articleData = {
        project_id: projectId,
        title: formData.title.trim(),
        abstract: formData.abstract.trim() || null,
        authors: formData.authors.trim() ? formData.authors.split(",").map(a => a.trim()) : null,
        publication_year: validYear,
        publication_month: validMonth,
        publication_day: validDay,
        journal_title: formData.journal_title.trim() || null,
        journal_issn: formData.journal_issn.trim() || null,
        journal_eissn: formData.journal_eissn.trim() || null,
        journal_publisher: formData.journal_publisher.trim() || null,
        volume: formData.volume.trim() || null,
        issue: formData.issue.trim() || null,
        pages: formData.pages.trim() || null,
        doi: formData.doi.trim() || null,
        pmid: formData.pmid.trim() || null,
        pmcid: formData.pmcid.trim() || null,
        arxiv_id: formData.arxiv_id.trim() || null,
        pii: formData.pii.trim() || null,
        keywords: formData.keywords.trim() ? formData.keywords.split(",").map(k => k.trim()) : null,
        mesh_terms: formData.mesh_terms.trim() ? formData.mesh_terms.split(",").map(m => m.trim()) : null,
        url_landing: formData.url_landing.trim() || null,
        language: formData.language.trim() || null,
        article_type: formData.article_type.trim() || null,
        publication_status: formData.publication_status.trim() || null,
        study_design: formData.study_design.trim() || null,
        conflicts_of_interest: formData.conflicts_of_interest.trim() || null,
        data_availability: formData.data_availability.trim() || null,
        open_access: formData.open_access,
        license: formData.license.trim() || null,
        ingestion_source: mode === 'add' ? "MANUAL" : undefined,
      };

      let result;
      if (mode === 'add') {
        const { data, error } = await supabase
          .from("articles")
          .insert([articleData])
          .select()
          .single();
        
        if (error) throw error;
        result = data;
      } else {
        const { data, error } = await supabase
          .from("articles")
          .update(articleData)
          .eq("id", articleId)
          .select()
          .single();
        
        if (error) throw error;
        result = data;
      }

      toast.success(`Artigo ${mode === 'add' ? 'criado' : 'atualizado'} com sucesso!`);
      
      if (mode === 'add') {
        // Navegar de volta para a lista de artigos do projeto
        navigate(`/projects/${projectId}?tab=articles`);
      } else {
        onComplete?.();
      }
    } catch (error: any) {
      console.error("Error saving article:", error);
      const errorMessage = error?.message || error?.details || `Erro ao ${mode === 'add' ? 'criar' : 'atualizar'} artigo`;
      toast.error(`Erro ao ${mode === 'add' ? 'criar' : 'atualizar'} artigo: ${errorMessage}`);
    } finally {
      setSaving(false);
    }
  };

  const downloadFile = async (file: ArticleFile) => {
    try {
      const { data, error } = await supabase.storage
        .from("articles")
        .download(file.storage_key);

      if (error) throw error;

      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.original_filename || "document.pdf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error: any) {
      console.error("Error downloading file:", error);
      toast.error("Erro ao baixar arquivo");
    }
  };

  const handleDeleteFile = async () => {
    if (!fileToDelete) return;

    setDeletingFile(true);
    try {
      // Deletar arquivo do storage
      const { error: storageError } = await supabase.storage
        .from("articles")
        .remove([fileToDelete.storage_key]);

      if (storageError) {
        console.warn("Erro ao deletar arquivo do storage:", storageError);
      }

      // Deletar registro do banco
      const { error: dbError } = await supabase
        .from("article_files")
        .delete()
        .eq("id", fileToDelete.id);

      if (dbError) throw dbError;

      toast.success("Arquivo removido com sucesso!");
      loadFiles(); // Recarregar lista de arquivos
      setDeleteDialogOpen(false);
      setFileToDelete(null);
    } catch (error: any) {
      console.error("Error deleting file:", error);
      toast.error("Erro ao remover arquivo");
    } finally {
      setDeletingFile(false);
    }
  };

  const openDeleteDialog = (file: ArticleFile) => {
    setFileToDelete(file);
    setDeleteDialogOpen(true);
  };

  const viewPDF = async (file: ArticleFile) => {
    try {
      const { data: fileData, error: downloadError } = await supabase.storage
        .from("articles")
        .download(file.storage_key);

      if (downloadError) {
        console.error("Error downloading file:", downloadError);
        throw downloadError;
      }

      const blob = new Blob([fileData], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (error: any) {
      console.error("Error viewing PDF:", error);
      toast.error("Erro ao visualizar PDF. Tente fazer o download.");
    }
  };

  const isStepValid = (step: FormStep): boolean => {
    switch (step) {
      case 'basic':
        return !!formData.title.trim();
      case 'publication':
        return true; // Opcional
      case 'identifiers':
        return true; // Opcional
      case 'additional':
        return true; // Opcional
      case 'files':
        return true; // Opcional
      default:
        return true;
    }
  };

  const getStepStatus = (step: FormStep): 'pending' | 'current' => {
    if (step === currentStep) return 'current';
    return 'pending';
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 'basic':
        return (
          <Card>
            <CardHeader>
              <CardTitle>Informações Básicas</CardTitle>
              <CardDescription>
                Título, resumo e informações dos autores
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <Label htmlFor="title">Título *</Label>
                <Textarea
                  id="title"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="Título completo do artigo"
                  className="min-h-[100px]"
                  required
                />
              </div>

              <div>
                <Label htmlFor="abstract">Resumo</Label>
                <Textarea
                  id="abstract"
                  value={formData.abstract}
                  onChange={(e) => setFormData({ ...formData, abstract: e.target.value })}
                  placeholder="Resumo ou abstract do artigo"
                  rows={6}
                />
              </div>

              <div>
                <Label htmlFor="authors">Autores</Label>
                <Input
                  id="authors"
                  value={formData.authors}
                  onChange={(e) => setFormData({ ...formData, authors: e.target.value })}
                  placeholder="Separe os autores por vírgula"
                />
              </div>
            </CardContent>
          </Card>
        );

      case 'publication':
        return (
          <Card>
            <CardHeader>
              <CardTitle>Detalhes da Publicação</CardTitle>
              <CardDescription>
                Informações sobre a revista, volume e páginas
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <Label htmlFor="journal_title">Revista/Jornal</Label>
                <Input
                  id="journal_title"
                  value={formData.journal_title}
                  onChange={(e) => setFormData({ ...formData, journal_title: e.target.value })}
                  placeholder="Nome da revista científica"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="publication_year">Ano de Publicação</Label>
                  <Input
                    id="publication_year"
                    type="number"
                    value={formData.publication_year}
                    onChange={(e) => handleDateFieldChange('publication_year', e.target.value)}
                    onBlur={(e) => validateDateField('publication_year', e.target.value)}
                    placeholder="2024"
                    min="1600"
                    max="2500"
                    className={validationErrors.publication_year ? "border-destructive" : ""}
                  />
                  {validationErrors.publication_year && (
                    <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      {validationErrors.publication_year}
                    </p>
                  )}
                </div>
                <div>
                  <Label htmlFor="publication_month">Mês de Publicação</Label>
                  <Input
                    id="publication_month"
                    type="number"
                    value={formData.publication_month}
                    onChange={(e) => handleDateFieldChange('publication_month', e.target.value)}
                    onBlur={(e) => validateDateField('publication_month', e.target.value)}
                    placeholder="1-12"
                    min="1"
                    max="12"
                    className={validationErrors.publication_month ? "border-destructive" : ""}
                  />
                  {validationErrors.publication_month && (
                    <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      {validationErrors.publication_month}
                    </p>
                  )}
                </div>
              </div>
              
              <div>
                <Label htmlFor="publication_day">Dia de Publicação</Label>
                <Input
                  id="publication_day"
                  type="number"
                  value={formData.publication_day}
                  onChange={(e) => handleDateFieldChange('publication_day', e.target.value)}
                  onBlur={(e) => validateDateField('publication_day', e.target.value)}
                  placeholder="1-31"
                  min="1"
                  max="31"
                  className={validationErrors.publication_day ? "border-destructive" : ""}
                />
                {validationErrors.publication_day && (
                  <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {validationErrors.publication_day}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="volume">Volume</Label>
                  <Input
                    id="volume"
                    value={formData.volume}
                    onChange={(e) => setFormData({ ...formData, volume: e.target.value })}
                    placeholder="12"
                  />
                </div>
                <div>
                  <Label htmlFor="issue">Edição</Label>
                  <Input
                    id="issue"
                    value={formData.issue}
                    onChange={(e) => setFormData({ ...formData, issue: e.target.value })}
                    placeholder="3"
                  />
                </div>
                <div>
                  <Label htmlFor="pages">Páginas</Label>
                  <Input
                    id="pages"
                    value={formData.pages}
                    onChange={(e) => setFormData({ ...formData, pages: e.target.value })}
                    placeholder="123-145"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="journal_issn">ISSN</Label>
                <Input
                  id="journal_issn"
                  value={formData.journal_issn}
                  onChange={(e) => setFormData({ ...formData, journal_issn: e.target.value })}
                  placeholder="1234-5678"
                />
              </div>
            </CardContent>
          </Card>
        );

      case 'identifiers':
        return (
          <Card>
            <CardHeader>
              <CardTitle>Identificadores</CardTitle>
              <CardDescription>
                DOI, PMID, PMCID e outros identificadores únicos
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <Label htmlFor="doi">DOI</Label>
                <Input
                  id="doi"
                  value={formData.doi}
                  onChange={(e) => setFormData({ ...formData, doi: e.target.value })}
                  placeholder="10.xxxx/xxxxx"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="pmid">PMID</Label>
                  <Input
                    id="pmid"
                    value={formData.pmid}
                    onChange={(e) => setFormData({ ...formData, pmid: e.target.value })}
                    placeholder="PubMed ID"
                  />
                </div>
                <div>
                  <Label htmlFor="pmcid">PMCID</Label>
                  <Input
                    id="pmcid"
                    value={formData.pmcid}
                    onChange={(e) => setFormData({ ...formData, pmcid: e.target.value })}
                    placeholder="PMC ID"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="arxiv_id">arXiv ID</Label>
                  <Input
                    id="arxiv_id"
                    value={formData.arxiv_id}
                    onChange={(e) => setFormData({ ...formData, arxiv_id: e.target.value })}
                    placeholder="arXiv:1234.5678"
                  />
                </div>
                <div>
                  <Label htmlFor="pii">PII</Label>
                  <Input
                    id="pii"
                    value={formData.pii}
                    onChange={(e) => setFormData({ ...formData, pii: e.target.value })}
                    placeholder="Publisher Item Identifier"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        );

      case 'additional':
        return (
          <Card>
            <CardHeader>
              <CardTitle>Informações Adicionais</CardTitle>
              <CardDescription>
                Palavras-chave, metadados e outras informações
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <Label htmlFor="keywords">Palavras-chave</Label>
                <Input
                  id="keywords"
                  value={formData.keywords}
                  onChange={(e) => setFormData({ ...formData, keywords: e.target.value })}
                  placeholder="Separe as palavras-chave por vírgula"
                />
              </div>

              <div>
                <Label htmlFor="mesh_terms">Termos MeSH</Label>
                <Input
                  id="mesh_terms"
                  value={formData.mesh_terms}
                  onChange={(e) => setFormData({ ...formData, mesh_terms: e.target.value })}
                  placeholder="Termos MeSH separados por vírgula"
                />
              </div>

              <div>
                <Label htmlFor="url_landing">URL do Artigo</Label>
                <Input
                  id="url_landing"
                  type="url"
                  value={formData.url_landing}
                  onChange={(e) => setFormData({ ...formData, url_landing: e.target.value })}
                  placeholder="https://..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="language">Idioma</Label>
                  <Input
                    id="language"
                    value={formData.language}
                    onChange={(e) => setFormData({ ...formData, language: e.target.value })}
                    placeholder="Português, Inglês, etc."
                  />
                </div>
                <div>
                  <Label htmlFor="article_type">Tipo de Artigo</Label>
                  <Input
                    id="article_type"
                    value={formData.article_type}
                    onChange={(e) => setFormData({ ...formData, article_type: e.target.value })}
                    placeholder="Artigo original, Revisão, etc."
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        );

      case 'files':
        return (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Arquivos do Artigo</CardTitle>
                  <CardDescription>
                    PDFs e outros documentos relacionados
                  </CardDescription>
                </div>
                <Button
                  onClick={() => setShowFileUpload(true)}
                  disabled={mode === 'add'}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Adicionar Arquivos
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {mode === 'add' ? (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Salve o artigo primeiro para poder adicionar arquivos.
                  </AlertDescription>
                </Alert>
              ) : files.length > 0 ? (
                <div className="space-y-3">
                  {files.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center justify-between p-4 border rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <FileText className="h-5 w-5 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">
                            {file.original_filename || "document.pdf"}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="outline" className="text-xs">
                              {file.file_role}
                            </Badge>
                            {file.bytes && (
                              <span className="text-xs text-muted-foreground">
                                {(file.bytes / 1024 / 1024).toFixed(2)} MB
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => viewPDF(file)}
                        >
                          <Eye className="mr-2 h-4 w-4" />
                          Visualizar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => downloadFile(file)}
                        >
                          <Download className="mr-2 h-4 w-4" />
                          Baixar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openDeleteDialog(file)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Excluir
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Upload className="mx-auto h-12 w-12 mb-4 opacity-50" />
                  <p>Nenhum arquivo adicionado ainda</p>
                  <p className="text-sm">Clique em "Adicionar Arquivos" para começar</p>
                </div>
              )}
            </CardContent>
          </Card>
        );

      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
          <p>Carregando artigo...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex h-16 items-center px-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(-1)}
            className="mr-4"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar
          </Button>
          
          <div className="flex-1">
            <h1 className="text-xl font-semibold">
              {mode === 'add' ? 'Adicionar Artigo' : 'Editar Artigo'}
            </h1>
            {article && (
              <p className="text-sm text-muted-foreground truncate">
                {article.title}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => navigate(-1)}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !isStepValid('basic')}
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Salvando...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  {mode === 'add' ? 'Criar Artigo' : 'Salvar Alterações'}
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar de Navegação */}
        <div className="w-80 border-r bg-muted/30 flex flex-col">
          <div className="p-6">
            <h2 className="font-semibold mb-4">Etapas do Formulário</h2>
            <div className="space-y-2">
              {STEPS.map((step) => {
                const status = getStepStatus(step.id);
                const isValid = isStepValid(step.id);
                const Icon = step.icon;
                
                return (
                  <button
                    key={step.id}
                    onClick={() => setCurrentStep(step.id)}
                    className={`w-full text-left p-3 rounded-lg transition-colors ${
                      status === 'current'
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-muted'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                        status === 'current'
                          ? 'bg-primary-foreground/20'
                          : 'bg-muted-foreground/20 text-muted-foreground'
                      }`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{step.label}</p>
                        <p className="text-xs opacity-75">{step.description}</p>
                      </div>
                      {status === 'current' && !isValid && (
                        <AlertCircle className="h-4 w-4 text-yellow-500" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Conteúdo Principal */}
        <div className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="p-6 max-w-4xl">
              {renderStepContent()}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* Modal de Upload de Arquivos */}
      {showFileUpload && articleId && (
        <ArticleFileUploadDialogNew
          open={showFileUpload}
          onOpenChange={setShowFileUpload}
          articleId={articleId}
          projectId={projectId}
          onFileUploaded={() => {
            loadFiles();
            setShowFileUpload(false);
          }}
        />
      )}

      {/* Dialog de Confirmação de Exclusão */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar Remoção</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja remover o arquivo "{fileToDelete?.original_filename}"?
              Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingFile}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteFile}
              disabled={deletingFile}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingFile ? "Removendo..." : "Remover"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

