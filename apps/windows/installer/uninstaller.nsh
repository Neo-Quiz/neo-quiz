!include "LogicLib.nsh"
!include "WinMessages.nsh"
!include "nsDialogs.nsh"

!ifndef BUILD_UNINSTALLER
    /* AN UPDATE NEVER STOPS ON THE OLD VERSION'S UNINSTALLER (2026-10-09).
       Before installing, electron-builder runs the previous version's
       uninstaller, which MOVES every file out of the install folder one by
       one and gives up (exit code 2, after five tries) on the first file it
       cannot move; the default `handleUninstallResult` then shows "Failed to
       uninstall old application files: 2" and quits, so the update never
       lands. Seen at almost every update on two PCs. That uninstaller puts
       every file back when it gives up, so the folder is the old version,
       whole: the new files are simply written over it (the extraction has
       its own retries for a file still in use). Documented hook of
       electron-builder: defining it replaces the failure dialog. */

    /* THE OLD VERSION'S UNINSTALLER IS NOT RUN AT ALL (2026-10-09, the
       hook below was not enough: the error came back on the laptop with
       1.20.54). electron-builder runs it only when it finds its
       `UninstallString` in the registry; removing that value here, before
       the install section, makes `uninstallOldVersion` return at once. The
       new files are then written over the old ones in the same folder
       (`InstallLocation` is kept, so `$INSTDIR` is the same), and
       `registryAddInstallInfo` writes `UninstallString` back at the end of
       the install. A file the new version no longer ships stays behind: a
       few kilobytes, against an update that never landed. */
    !macro customInit
        DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
        DeleteRegValue HKEY_CURRENT_USER "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
        !ifdef UNINSTALL_REGISTRY_KEY_2
            DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" "UninstallString"
            DeleteRegValue HKEY_CURRENT_USER "${UNINSTALL_REGISTRY_KEY_2}" "UninstallString"
        !endif
    !macroend

    !macro customUnInstallCheck
        ${if} $R0 != 0
            DetailPrint "The previous version could not be removed (code $R0): installing over it."
        ${endif}
        ClearErrors
    !macroend
    !macro customUnInstallCheckCurrentUser
        !insertmacro customUnInstallCheck
    !macroend
!endif

!ifdef BUILD_UNINSTALLER
    /* Comme Google Play Games : Windows a déjà reçu un clic explicite sur
       « Désinstaller », donc aucun assistant, texte explicatif ou écran final.
       La page INSTFILES travaille réellement en arrière-plan ; on ne garde à
       l'écran qu'une petite fenêtre native et sa barre de progression. */
    !define removeDefaultUninstallWelcomePage
    !define MUI_PAGE_CUSTOMFUNCTION_SHOW un.NeoQuizAfficherDesinstallationSimple
    AutoCloseWindow true

    Var NeoQuizDialogueProgression
    Var NeoQuizProgressionNative
    Var NeoQuizFond
    Var NeoQuizCadreProgression
    Var NeoQuizPisteProgression
    Var NeoQuizRemplissageProgression
    Var NeoQuizBarreX
    Var NeoQuizBarreY
    Var NeoQuizBarreLargeur
    Var NeoQuizBarreHauteur

    Function un.NeoQuizAfficherDesinstallationSimple
        /* Cache tout le wizard NSIS : boutons, séparateurs, titre de page,
           détails et marque/version. */
        GetDlgItem $0 $HWNDPARENT 1
        ShowWindow $0 ${SW_HIDE}
        GetDlgItem $0 $HWNDPARENT 2
        ShowWindow $0 ${SW_HIDE}
        GetDlgItem $0 $HWNDPARENT 3
        ShowWindow $0 ${SW_HIDE}
        GetDlgItem $0 $HWNDPARENT 1028
        ShowWindow $0 ${SW_HIDE}
        GetDlgItem $0 $HWNDPARENT 1034
        ShowWindow $0 ${SW_HIDE}
        GetDlgItem $0 $HWNDPARENT 1035
        ShowWindow $0 ${SW_HIDE}
        GetDlgItem $0 $HWNDPARENT 1036
        ShowWindow $0 ${SW_HIDE}
        GetDlgItem $0 $HWNDPARENT 1037
        ShowWindow $0 ${SW_HIDE}
        GetDlgItem $0 $HWNDPARENT 1038
        ShowWindow $0 ${SW_HIDE}
        GetDlgItem $0 $HWNDPARENT 1039
        ShowWindow $0 ${SW_HIDE}
        GetDlgItem $0 $HWNDPARENT 1045
        ShowWindow $0 ${SW_HIDE}
        GetDlgItem $0 $HWNDPARENT 1256
        ShowWindow $0 ${SW_HIDE}

        FindWindow $NeoQuizDialogueProgression "#32770" "" $HWNDPARENT
        ${If} $NeoQuizDialogueProgression == 0
            Return
        ${EndIf}

        /* La barre NSIS reste active mais invisible : PBM_GETPOS fournit donc
           la progression réelle, pas une animation estimée. */
        GetDlgItem $NeoQuizProgressionNative $NeoQuizDialogueProgression 1004
        ShowWindow $NeoQuizProgressionNative ${SW_HIDE}
        GetDlgItem $0 $NeoQuizDialogueProgression 1006
        ShowWindow $0 ${SW_HIDE}
        GetDlgItem $0 $NeoQuizDialogueProgression 1027
        ShowWindow $0 ${SW_HIDE}
        GetDlgItem $0 $NeoQuizDialogueProgression 1016
        ShowWindow $0 ${SW_HIDE}

        /* Titre Windows natif, simplement « Neo Quiz ». Pas de faux chrome,
           pas de fond de l'installeur, pas de spinner ni de pourcentage. */
        SendMessage $HWNDPARENT ${WM_SETTEXT} 0 "STR:Neo Quiz"

        System::Call 'user32::GetDpiForWindow(p$HWNDPARENT)i.R0'
        ${If} $R0 <= 0
            StrCpy $R0 96
        ${EndIf}

        /* Gabarit volontairement proche de la petite fenêtre Google Play Games. */
        IntOp $R1 330 * $R0
        IntOp $R1 $R1 / 96
        IntOp $R2 116 * $R0
        IntOp $R2 $R2 / 96
        System::Call 'user32::GetSystemMetrics(i0)i.R3'
        System::Call 'user32::GetSystemMetrics(i1)i.R4'
        IntOp $R3 $R3 - $R1
        IntOp $R3 $R3 / 2
        IntOp $R4 $R4 - $R2
        IntOp $R4 $R4 / 2
        System::Call 'user32::MoveWindow(p$HWNDPARENT,i$R3,i$R4,i$R1,i$R2,i1)'

        /* À 96 DPI, 31 px environ sont consommés par la barre de titre native. */
        IntOp $R3 85 * $R0
        IntOp $R3 $R3 / 96
        System::Call 'user32::MoveWindow(p$NeoQuizDialogueProgression,i0,i0,i$R1,i$R3,i1)'

        /* Surface claire et unie : aucune illustration, lueur ou décoration. */
        System::Call 'user32::CreateWindowExW(i0,w "STATIC",w "",i0x50000000,i0,i0,i$R1,i$R3,p$NeoQuizDialogueProgression,p0,p0,p0)p.R7'
        StrCpy $NeoQuizFond $R7
        SetCtlColors $NeoQuizFond 000000 F6F6F6

        /* Barre plate, seule information visible. Le cadre gris d'un pixel et
           la piste claire reprennent volontairement le rendu de référence. */
        IntOp $NeoQuizBarreX 29 * $R0
        IntOp $NeoQuizBarreX $NeoQuizBarreX / 96
        IntOp $NeoQuizBarreY 35 * $R0
        IntOp $NeoQuizBarreY $NeoQuizBarreY / 96
        IntOp $NeoQuizBarreLargeur 272 * $R0
        IntOp $NeoQuizBarreLargeur $NeoQuizBarreLargeur / 96
        IntOp $NeoQuizBarreHauteur 12 * $R0
        IntOp $NeoQuizBarreHauteur $NeoQuizBarreHauteur / 96
        ${If} $NeoQuizBarreHauteur < 4
            StrCpy $NeoQuizBarreHauteur 4
        ${EndIf}

        IntOp $R5 28 * $R0
        IntOp $R5 $R5 / 96
        IntOp $R6 34 * $R0
        IntOp $R6 $R6 / 96
        IntOp $R7 274 * $R0
        IntOp $R7 $R7 / 96
        IntOp $R8 14 * $R0
        IntOp $R8 $R8 / 96
        System::Call 'user32::CreateWindowExW(i0,w "STATIC",w "",i0x50000000,i$R5,i$R6,i$R7,i$R8,p$NeoQuizDialogueProgression,p0,p0,p0)p.R9'
        StrCpy $NeoQuizCadreProgression $R9
        SetCtlColors $NeoQuizCadreProgression 000000 BFC1C4

        System::Call 'user32::CreateWindowExW(i0,w "STATIC",w "",i0x50000000,i$NeoQuizBarreX,i$NeoQuizBarreY,i$NeoQuizBarreLargeur,i$NeoQuizBarreHauteur,p$NeoQuizDialogueProgression,p0,p0,p0)p.R7'
        StrCpy $NeoQuizPisteProgression $R7
        SetCtlColors $NeoQuizPisteProgression 000000 E5E5E5

        System::Call 'user32::CreateWindowExW(i0,w "STATIC",w "",i0x50000000,i$NeoQuizBarreX,i$NeoQuizBarreY,i1,i$NeoQuizBarreHauteur,p$NeoQuizDialogueProgression,p0,p0,p0)p.R7'
        StrCpy $NeoQuizRemplissageProgression $R7
        SetCtlColors $NeoQuizRemplissageProgression 000000 00B83F

        ${NSD_CreateTimer} un.NeoQuizRafraichirDesinstallation 35
        Call un.NeoQuizRafraichirDesinstallation
    FunctionEnd

    Function un.NeoQuizRafraichirDesinstallation
        ${If} $NeoQuizProgressionNative == 0
            Return
        ${EndIf}

        SendMessage $NeoQuizProgressionNative ${PBM_GETRANGE} 0 0 $R0
        SendMessage $NeoQuizProgressionNative ${PBM_GETPOS} 0 0 $R1
        ${If} $R0 > 0
            IntOp $R2 $R1 * 100
            IntOp $R2 $R2 / $R0
        ${Else}
            StrCpy $R2 0
        ${EndIf}
        ${If} $R2 < 0
            StrCpy $R2 0
        ${ElseIf} $R2 > 100
            StrCpy $R2 100
        ${EndIf}

        IntOp $R3 $NeoQuizBarreLargeur * $R2
        IntOp $R3 $R3 / 100
        ${If} $R3 <= 0
            ShowWindow $NeoQuizRemplissageProgression ${SW_HIDE}
        ${Else}
            System::Call 'user32::MoveWindow(p$NeoQuizRemplissageProgression,i$NeoQuizBarreX,i$NeoQuizBarreY,i$R3,i$NeoQuizBarreHauteur,i1)'
            ShowWindow $NeoQuizRemplissageProgression ${SW_SHOW}
        ${EndIf}
    FunctionEnd

    !macro customUnInstall
        SetDetailsPrint listonly
    !macroend

    Function un.NeoQuizIgnorerPageFinale
        ${NSD_KillTimer} un.NeoQuizRafraichirDesinstallation
        Abort
    FunctionEnd

    !macro customUninstallPage
        /* Aucun écran « Terminé » : la fenêtre disparaît dès que la vraie
           désinstallation est finie. */
        !define MUI_PAGE_CUSTOMFUNCTION_PRE un.NeoQuizIgnorerPageFinale
    !macroend
!endif
