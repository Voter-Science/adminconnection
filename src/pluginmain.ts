// Sample 'Hello World' Plugin template.
// Demonstrates:
// - typescript
// - using trc npm modules and browserify
// - uses promises. 
// - basic scaffolding for error reporting. 
// This calls TRC APIs and binds to specific HTML elements from the page.  

import * as XC from 'trc-httpshim/xclient'
import * as common from 'trc-httpshim/common'

import * as core from 'trc-core/core'

import * as trcSheet from 'trc-sheet/sheet'
import * as trcSheetEx from 'trc-sheet/sheetEx'

import * as plugin from 'trc-web/plugin'
import * as trchtml from 'trc-web/html'
import * as tablewriter from 'trc-web/tablewriter'
import * as bcl from 'trc-analyze/collections'


// Installed via:
//   npm install --save-dev @types/jquery
// requires tsconfig: "allowSyntheticDefaultImports" : true 
declare var $: JQueryStatic;

// Provide easy error handle for reporting errors from promises.  Usage:
//   p.catch(showError);
declare var showError: (error: any) => void; // error handler defined in index.html

function strAgo(time : Date | string) {
    var x = new Date(time.toString());
    var now = new Date();
    return new bcl.TimeRange(x, now).getDurationSecondsPretty() + " ago";
}

export class MyPlugin {
    private _sheet: trcSheet.SheetClient;
    private _pluginClient: plugin.PluginClient;

    public static BrowserEntryAsync(
        auth: plugin.IStart,
        opts: plugin.IPluginOptions
    ): Promise<MyPlugin> {

        var pluginClient = new plugin.PluginClient(auth, opts);

        var plugin2 = new MyPlugin(pluginClient);
        return plugin2.InitAsync().then(() => {
            return plugin2;
        });
    }

    // Expose constructor directly for tests. They can pass in mock versions. 
    public constructor(p: plugin.PluginClient) {
        this._sheet = new trcSheet.SheetClient(p.HttpClient, p.SheetId);
    }


    // Make initial network calls to setup the plugin. 
    // Need this as a separate call from the ctor since ctors aren't async. 
    private InitAsync(): Promise<void> {
        this.pauseUI();
        var admin = new trcSheet.SheetAdminClient(this._sheet);
        
        // Wait if there are already outstanding operations. 
        return admin.WaitAsync().then( ()=> {
            this.resumeUI();
            return this._sheet.getInfoAsync().then(info => {
                this.onShowRebaseLog();
                this.updateInfo(info);
            });
        });        
    }

    // Display sheet info on HTML page
    public updateInfo(info: trcSheet.ISheetInfoResult): void {
        $("#SheetName").text(info.Name);
        $("#ParentSheetName").text(info.ParentName);
        $("#SheetVer").text(info.LatestVersion);
        $("#RowCount").text(info.CountRecords);

        $("#LastRefreshed").text(new Date().toLocaleString());

        var syncStatus : ISyncStatus = (<any> info).SyncStatus;
        if (!!syncStatus) {
            $("#syncStatus").show();
            $("#Kind").text(syncStatus.Kind);
            $("#Description").text(syncStatus.Description);
            $("#LastSyncVersion").text(syncStatus.LastSyncVersion);
            $("#LastUpdateTime").text(strAgo(syncStatus.LastUpdateTime));

            if (!!syncStatus.ErrorMessage && syncStatus.ErrorMessage.length > 0)
            {
                $("#ErrorMessage").text("Error: " + syncStatus.ErrorMessage);
                $("#SyncStatusMsg").addClass("PreUpload");
            } else {
                if (syncStatus.LastSyncVersion >= info.LatestVersion)
                {
                    $("#ErrorMessage").text("Current!");
                } else {
                    var msg = (info.LatestVersion + 1 - syncStatus.LastSyncVersion) + " deltas behind current.";
                    $("#ErrorMessage").text(msg);
                }
                $("#SyncStatusMsg").addClass("OkUpload");
            }
        } else {
            $("#syncStatus").hide();
        }
    }

    // Example of a helper function.
    public doubleit(val: number): number {
        return val * 2;
    }

    // Demonstrate receiving UI handlers 
    public onShowRebaseLog(): void {
        var tw = new tablewriter.TableWriter<IDisplayRow>($("#historyLog"), 
            ["Version", "TimeAgo", "Comment"]);
        var list: trcSheet.IRebaseHistoryItem[] = [];
        this._sheet.getRebaseLogAsync().then(iter => iter.ForEach(
            (item) => {
                // filter out 'Geocode update', too noisy. 
                if (item.Comment.indexOf('Geocode update') > 0) {
                    return;
                }

                list.push(item);
            }
        )).then(() => {
            list.reverse(); // Show most recent first. 
            for (var item of list) {
                var ago = strAgo(item.ActualTime);

                var row: IDisplayRow =
                {
                    Version: item.Version,
                    Comment: item.Comment,
                    TimeAgo: ago
                };
                tw.writeRow(row);
            }
        }).catch(showError);
    }


    public onClickRefresh() : void {

        var admin = new trcSheet.SheetAdminClient(this._sheet);

        // Pause UI 
        this.pauseUI();
        admin.postOpRefreshAsync().then( ()=> {
            this.resumeUI(); // Will 202... 
        }).catch(showError);
    }

    private pauseUI() : void {
        trchtml.Loading("mode2wait");
        $("#Mode1").hide();
        $("#Mode2").show();
    }
    private resumeUI() : void {
        $("#Mode2").hide();
        $("#Mode1").show();
    }

    // downloading all contents and rendering them to HTML can take some time. 
    public onGetSheetContents(): void {
        trchtml.Loading("contents");
        //$("#contents").empty();
        //$("#contents").text("Loading...");

        trcSheetEx.SheetEx.InitAsync(this._sheet, undefined).then((sheetEx) => {
            return this._sheet.getSheetContentsAsync().then((contents) => {
                var render = new trchtml.SheetControl("contents", sheetEx);
                // could set other options on render() here
                render.render();
            }).catch(showError);
        });
    }
}

interface IDisplayRow {
    Version: number;
    TimeAgo: string;
    Comment: string;
}

// $$$ Should be in core. 
// 'SyncStatus' property on info. 
interface ISyncStatus
{
    Kind : string;
    Description : string;

    // Last version (exclusive) of this sheet which has been synced externally. 
    // Current if (info.SyncStatus.LastSyncVersion > info.Version) 
    LastSyncVersion : number;

    // Non-null if there was an error trying to sync.
    // This can just be a user-visible exception message.
    // The full exception callstack is written to logging
    ErrorMessage : string;

    // UTC time for last attempted time.
    // This is more interesting if there's an error
    LastUpdateTime : string;
}