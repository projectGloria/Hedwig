// Git invokes this helper over stdin. Never persist or print tokens for unrelated hosts.
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  if (process.argv.at(-1) !== "get") return;
  const fields = Object.fromEntries(
    input
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
  if (fields.protocol !== "https") return;
  const token =
    fields.host === "github.com"
      ? process.env.HEDWIG_GITHUB_TOKEN
      : fields.host === "gitlab.com"
        ? process.env.HEDWIG_GITLAB_TOKEN
        : undefined;
  if (token)
    process.stdout.write(
      `username=${fields.host === "github.com" ? "x-access-token" : "oauth2"}\npassword=${token}\n\n`,
    );
});
