const runId = process.argv[2] || '32479521343';

async function check() {
    console.log(`Checking GitHub Actions Workflow Run #${runId}...`);
    while (true) {
        try {
            const res = await fetch(`https://api.github.com/repos/CieL7s/artoria-baileys/actions/runs/${runId}`, {
                headers: { 'User-Agent': 'Artoria-Baileys-CI-Watcher' }
            });
            const data = await res.json();
            console.log(`[${new Date().toISOString()}] Run Status: ${data.status} | Conclusion: ${data.conclusion || 'Running...'}`);

            const jobsRes = await fetch(`https://api.github.com/repos/CieL7s/artoria-baileys/actions/runs/${runId}/jobs`, {
                headers: { 'User-Agent': 'Artoria-Baileys-CI-Watcher' }
            });
            const jobsData = await jobsRes.json();
            if (jobsData.jobs) {
                for (const j of jobsData.jobs) {
                    console.log(`  - [${j.name}] Status: ${j.status}, Conclusion: ${j.conclusion || 'in progress'}`);
                }
            }

            if (data.status === 'completed') {
                console.log(`\n🎉 Workflow Run completed with conclusion: ${data.conclusion}`);
                if (data.conclusion === 'success') {
                    process.exit(0);
                } else {
                    process.exit(1);
                }
            }
        } catch (e) {
            console.error('Error fetching status:', e.message);
        }
        await new Promise(r => setTimeout(r, 20000));
    }
}

check();
