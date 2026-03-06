import {t} from '@/lib/copy';

const Index = () => {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center">
          <h1 className="mb-4 text-4xl font-bold">{t('pages', 'indexWelcome')}</h1>
          <p className="text-xl text-muted-foreground">{t('pages', 'indexSubtitle')}</p>
      </div>
    </div>
  );
};

export default Index;
