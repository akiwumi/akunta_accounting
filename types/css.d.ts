// Allow TypeScript to accept CSS file side-effect imports (e.g. import "./globals.css")
declare module "*.css" {
  const styles: Record<string, string>;
  export default styles;
}
