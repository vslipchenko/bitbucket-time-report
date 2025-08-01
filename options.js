/**
 * Bitbucket Time Report Extension - Options/Settings Page
 * Handles configuration of organization and project settings
 */

document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('settingsForm');
    const organizationInput = document.getElementById('organization');
    const projectInput = document.getElementById('project');
    const saveButton = document.getElementById('saveButton');
    const resetButton = document.getElementById('resetButton');
    const statusDiv = document.getElementById('status');
    const urlPreview = document.getElementById('urlPreview');

    // Default settings.
    // organization and project values can be taken from the Pull Requests page in BitBucket if you navigate it manually, e.g.:
    // https://bitbucket.org/<organization>/<project>/pull-requests
    const defaultSettings = {
        organization: '',
        project: ''
    };

    /**
     * Load saved settings from Chrome storage
     */
    function loadSettings() {
        chrome.storage.sync.get(['bitbucketOrganization', 'bitbucketProject'], function(result) {
            organizationInput.value = result.bitbucketOrganization || defaultSettings.organization;
            projectInput.value = result.bitbucketProject || defaultSettings.project;
            updateUrlPreview();
        });
    }

    /**
     * Save settings to Chrome storage
     */
    function saveSettings() {
        const organization = organizationInput.value.trim();
        const project = projectInput.value.trim();

        // Validate inputs
        if (!organization || !project) {
            showStatus('Please fill in both organization and project fields.', 'error');
            return;
        }

        // Validate format (basic validation)
        const validPattern = /^[a-zA-Z0-9_-]+$/;
        if (!validPattern.test(organization)) {
            showStatus('Organization name can only contain letters, numbers, hyphens, and underscores.', 'error');
            return;
        }

        if (!validPattern.test(project)) {
            showStatus('Project name can only contain letters, numbers, hyphens, and underscores.', 'error');
            return;
        }

        // Save to storage
        chrome.storage.sync.set({
            bitbucketOrganization: organization,
            bitbucketProject: project
        }, function() {
            if (chrome.runtime.lastError) {
                showStatus('Error saving settings: ' + chrome.runtime.lastError.message, 'error');
            } else {
                showStatus('Settings saved successfully!', 'success');
                updateUrlPreview();
            }
        });
    }

    /**
     * Reset settings to defaults
     */
    function resetSettings() {
        organizationInput.value = defaultSettings.organization;
        projectInput.value = defaultSettings.project;
        updateUrlPreview();
        showStatus('Settings reset to defaults. Click "Save Settings" to apply.', 'success');
    }

    /**
     * Update the URL preview based on current input values
     */
    function updateUrlPreview() {
        const org = organizationInput.value.trim() || '<organization>';
        const proj = projectInput.value.trim() || '<project>';
        urlPreview.innerHTML = `https://bitbucket.org/<strong>${escapeHtml(org)}</strong>/<strong>${escapeHtml(proj)}</strong>/pull-requests/?state=MERGED&author={${escapeHtml('<user_uuid>')}}`;
    }

    /**
     * Show status message to user
     * @param {string} message - Message to display
     * @param {string} type - 'success' or 'error'
     */
    function showStatus(message, type) {
        statusDiv.textContent = message;
        statusDiv.className = `status ${type}`;
        statusDiv.style.display = 'block';
        
        // Hide after 5 seconds for success messages
        if (type === 'success') {
            setTimeout(() => {
                statusDiv.style.display = 'none';
            }, 5000);
        }
    }

    /**
     * Escape HTML to prevent XSS in preview
     * @param {string} unsafe - Unsafe string
     * @returns {string} - Escaped string
     */
    function escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // Event listeners
    form.addEventListener('submit', function(e) {
        e.preventDefault();
        saveButton.disabled = true;
        saveSettings();
        setTimeout(() => {
            saveButton.disabled = false;
        }, 1000);
    });

    resetButton.addEventListener('click', function(e) {
        e.preventDefault();
        resetSettings();
    });

    // Update URL preview as user types
    organizationInput.addEventListener('input', updateUrlPreview);
    projectInput.addEventListener('input', updateUrlPreview);

    // Load settings on page load
    loadSettings();
});