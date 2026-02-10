export default function Footer() {
  return (
    <footer className="bg-white dark:bg-background text-foreground py-6 px-4 border-t">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} Auren. All rights reserved.
          </p>
          <p className="text-sm text-muted-foreground">
            Powered by AI
          </p>
        </div>
      </div>
    </footer>
  );
}
