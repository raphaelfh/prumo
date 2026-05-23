import {useLocation} from "react-router-dom";
import {useEffect} from "react";
import {t} from '@/lib/copy';

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center">
          <h1 className="mb-4 text-4xl font-bold text-foreground">{t('pages', 'notFoundTitle')}</h1>
          <p className="mb-4 text-xl text-muted-foreground">{t('pages', 'notFoundMessage')}</p>
        <a href="/" className="text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm">
            {t('pages', 'notFoundBackHome')}
        </a>
      </div>
    </div>
  );
};

export default NotFound;
