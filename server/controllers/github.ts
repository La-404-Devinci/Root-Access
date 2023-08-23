import Repository from "@/models/repository";
import axios, { AxiosInstance } from "axios";
import Settings from "./settings";
import Workspace from "./workspace";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

class Github {
    private agent: AxiosInstance;
    private data: { [key: string]: any } = {};
    private type: string = "";

    constructor(agent: AxiosInstance, data: { [key: string]: any }) {
        this.agent = agent;
        this.data = data;

        switch (data.type) {
            case "User":
                this.type = "users";
                break;
            case "Organization":
                this.type = "orgs";
                break;
            default:
                throw new Error(`Unknown GitHub account type: ${data.type}`);
        }
    }

    public static async create(): Promise<Github> {
        const agent = axios.create({
            headers: {
                Accept: "application/vnd.github.v3+json",
                Authorization: `token ${await Settings.get("github.token")}`,
            },
        });

        let user = null;

        try {
            user = await agent.get(`https://api.github.com/users/${await Settings.get("github.owner")}`);
        } catch (err: any) {
            throw new Error(`Failed to get GitHub user data: ${err.message}`);
        }

        const data = user.data;

        return new Github(agent, data);
    }

    public async listRepos(): Promise<Repository[]> {
        const res = await this.agent.get(`https://api.github.com/${this.type}/${this.data.login}/repos`);

        const repos: Repository[] = res.data.map((repo: any) => {
            return new Repository(repo.name, repo.owner.login);
        });

        return repos;
    }

    public async updateRepoPermissions(workspace: Workspace): Promise<void> {
        const targetPath = path.join(workspace.getRoot(), await Settings.get("repo.folderName"));
        execSync(`chown -R ${workspace.name}:${workspace.name} ${targetPath}`);
    }

    public async updateRepo(workspace: Workspace, repo: Repository): Promise<void> {
        if (await this.hasRepo(workspace)) {
            await this.pullRepo(workspace);
        } else {
            await this.cloneRepo(workspace, repo);
        }
    }

    public async hasRepo(workspace: Workspace): Promise<boolean> {
        return fs.existsSync(path.join(workspace.getRoot(), await Settings.get("repo.folderName")));
    }

    public async cloneRepo(workspace: Workspace, repo: Repository): Promise<void> {
        const targetPath = path.join(workspace.getRoot(), await Settings.get("repo.folderName"));

        if (fs.existsSync(targetPath)) {
            throw new Error(`Repository already exists at ${targetPath}`);
        }

        execSync(
            `git clone https://${repo.owner}:${await Settings.get("github.token")}@github.com/${repo.owner}/${repo.name} ${targetPath}`,
        );

        if (!fs.existsSync(targetPath)) {
            throw new Error(`Failed to clone repository to ${targetPath}`);
        }

        await this.updateRepoPermissions(workspace);
    }

    public async pullRepo(workspace: Workspace): Promise<void> {
        const targetPath = path.join(workspace.getRoot(), await Settings.get("repo.folderName"));

        if (!fs.existsSync(targetPath)) {
            throw new Error(`Repository does not exist at ${targetPath}`);
        }

        const result = execSync(`git -C ${targetPath} pull`).toString();

        if (result.includes("Already up to date.")) {
            throw new Error(`Repository was already up to date at ${targetPath}`);
        }

        if (result.includes("fatal:")) {
            throw new Error(`Failed to pull repository at ${targetPath}: ${result}`);
        }

        await this.updateRepoPermissions(workspace);
    }

    public async removeRepo(workspace: Workspace): Promise<void> {
        if (!(await this.hasRepo(workspace))) {
            throw new Error(`Repository does not exist at ${workspace.getRoot()}`);
        }

        execSync(`rm -rf ${workspace.getRoot()}/${await Settings.get("repo.folderName")}`);

        if (await this.hasRepo(workspace)) {
            throw new Error(`Failed to remove repository at ${workspace.getRoot()}`);
        }
    }
}

export default Github;
